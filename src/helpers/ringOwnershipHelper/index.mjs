import { Router } from 'express';

export class OwnershipError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

export function normalizeMemberEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new OwnershipError('Enter a valid Google account email.', 400);
  }
  return value.trim().toLowerCase();
}

export function createRingOwnershipStore(collection) {
  async function initialize() {
    await collection.createIndex({ participants: 1 }, { unique: true, name: 'unique_ring_participant' });
  }

  async function getMembership(email) {
    return collection.findOne({ participants: normalizeMemberEmail(email) });
  }

  async function getByRingId(ringAccountId) {
    return collection.findOne({ _id: ringAccountId });
  }

  async function claim(email, ringAccountId) {
    const ownerEmail = normalizeMemberEmail(email);
    if (typeof ringAccountId !== 'string' || !/^[1-9]\d*$/.test(ringAccountId)) {
      throw new OwnershipError('A verified Ring account is required.', 400);
    }
    const existing = await getMembership(ownerEmail);
    if (existing) {
      if (existing._id === ringAccountId && existing.ownerEmail === ownerEmail && !existing.releasing) return existing;
      throw new OwnershipError('You already own or have access to a Ring account. Leave it before connecting another.');
    }
    const ownership = { _id: ringAccountId, ownerEmail, participants: [ownerEmail], invitations: [] };
    try {
      await collection.insertOne(ownership);
      return ownership;
    } catch (error) {
      if (error.code === 11000) throw new OwnershipError('This Ring account is already owned, or you already have access to another account.');
      throw error;
    }
  }

  async function invite(owner, target) {
    const ownerEmail = normalizeMemberEmail(owner);
    const email = normalizeMemberEmail(target);
    if (ownerEmail === email) throw new OwnershipError('You cannot invite yourself.', 400);
    if (await getMembership(email)) throw new OwnershipError('This user already owns or has access to a Ring account.');
    const result = await collection.updateOne(
      { ownerEmail, participants: ownerEmail, releasing: { $ne: true } },
      { $addToSet: { invitations: email } }
    );
    if (!result.matchedCount) throw new OwnershipError('Only a Ring account owner can invite users.', 403);
  }

  async function getInvitations(email) {
    return collection.find(
      { invitations: normalizeMemberEmail(email), releasing: { $ne: true } },
      { projection: { _id: 1, ownerEmail: 1 } }
    ).toArray();
  }

  async function accept(email, ringAccountId) {
    const member = normalizeMemberEmail(email);
    if (await getMembership(member)) throw new OwnershipError('Leave your current Ring account before accepting an invitation.');
    try {
      const result = await collection.updateOne(
        { _id: ringAccountId, invitations: member, releasing: { $ne: true } },
        { $addToSet: { participants: member }, $pull: { invitations: member } }
      );
      if (!result.matchedCount) throw new OwnershipError('The invitation is no longer available.', 404);
    } catch (error) {
      if (error.code === 11000) throw new OwnershipError('You already own or have access to a Ring account.');
      throw error;
    }
  }

  async function remove(owner, target) {
    const ownerEmail = normalizeMemberEmail(owner);
    const email = normalizeMemberEmail(target);
    if (ownerEmail === email) throw new OwnershipError('The owner cannot remove themselves.', 400);
    const result = await collection.updateOne(
      { ownerEmail, participants: ownerEmail, releasing: { $ne: true } },
      { $pull: { participants: email, invitations: email } }
    );
    if (!result.matchedCount) throw new OwnershipError('Only a Ring account owner can remove access.', 403);
  }

  async function leave(email, onOwnerLeave) {
    const member = normalizeMemberEmail(email);
    const existing = await getMembership(member);
    if (!existing) throw new OwnershipError('You do not have a Ring account to leave.', 404);
    if (existing.ownerEmail === member) {
      const marked = await collection.updateOne(
        { _id: existing._id, ownerEmail: member },
        { $set: { releasing: true } }
      );
      if (!marked.matchedCount) throw new OwnershipError('Ring account ownership changed. Try again.');
      await onOwnerLeave(member);
      const result = await collection.deleteOne({ _id: existing._id, ownerEmail: member, releasing: true });
      if (!result.deletedCount) throw new OwnershipError('Ring account ownership changed. Try again.');
      return { owner: true };
    }
    await collection.updateOne({ _id: existing._id, ownerEmail: { $ne: member } }, { $pull: { participants: member } });
    return { owner: false };
  }

  return { initialize, getMembership, getByRingId, claim, invite, getInvitations, accept, remove, leave };
}

export function createRingOwnershipRouter(store, logger, onOwnerLeave) {
  const router = Router();
  const pendingLeaves = new Map();
  const handle = action => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await action(req, res);
    } catch (error) {
      if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.message });
      logger.error('Ring membership operation failed:', error);
      return res.status(500).json({ error: 'Could not update Ring access.' });
    }
  };
  router.get('/', handle(async (req, res) => {
    const membership = await store.getMembership(req.accountEmail);
    const invitations = await store.getInvitations(req.accountEmail);
    res.json({
      membership: membership ? {
        ringAccountId: membership._id,
        ownerEmail: membership.ownerEmail,
        role: membership.ownerEmail === req.accountEmail ? 'owner' : 'member',
        ...(membership.ownerEmail === req.accountEmail ? { participants: membership.participants, invitations: membership.invitations } : {})
      } : null,
      invitations: invitations.map(({ _id, ownerEmail }) => ({ ringAccountId: _id, ownerEmail }))
    });
  }));
  router.post('/invitations', handle(async (req, res) => {
    await store.invite(req.accountEmail, req.body?.email);
    res.status(204).end();
  }));
  router.post('/invitations/:ringAccountId/accept', handle(async (req, res) => {
    await store.accept(req.accountEmail, req.params.ringAccountId);
    res.status(204).end();
  }));
  router.delete('/members', handle(async (req, res) => {
    await store.remove(req.accountEmail, req.body?.email);
    res.status(204).end();
  }));
  router.post('/leave', handle(async (req, res) => {
    let pending = pendingLeaves.get(req.accountEmail);
    if (!pending) {
      pending = store.leave(req.accountEmail, onOwnerLeave);
      pendingLeaves.set(req.accountEmail, pending);
    }
    try {
      await pending;
    } finally {
      if (pendingLeaves.get(req.accountEmail) === pending) pendingLeaves.delete(req.accountEmail);
    }
    res.status(204).end();
  }));
  return router;
}
