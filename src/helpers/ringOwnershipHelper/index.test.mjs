import express from 'express';
import { createRingOwnershipRouter, createRingOwnershipStore } from './index.mjs';

function collection() {
  const documents = new Map();
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$ne' in value) return doc[key] !== value.$ne;
    return Array.isArray(doc[key]) ? doc[key].includes(value) : doc[key] === value;
  });
  const unique = (candidate, id) => {
    for (const [otherId, other] of documents) {
      if (otherId !== id && other.participants.some(email => candidate.participants.includes(email))) {
        throw Object.assign(new Error('duplicate participant'), { code: 11000 });
      }
    }
  };
  return {
    createIndex: jest.fn(async () => {}),
    findOne: async filter => {
      const doc = [...documents.values()].find(item => matches(item, filter));
      return doc && structuredClone(doc);
    },
    find: filter => ({ toArray: async () => [...documents.values()].filter(item => matches(item, filter)).map(item => structuredClone(item)) }),
    insertOne: async doc => {
      if (documents.has(doc._id)) throw Object.assign(new Error('duplicate id'), { code: 11000 });
      unique(doc, doc._id);
      documents.set(doc._id, structuredClone(doc));
    },
    updateOne: async (filter, update) => {
      const doc = [...documents.values()].find(item => matches(item, filter));
      if (!doc) return { matchedCount: 0 };
      const next = structuredClone(doc);
      for (const [key, value] of Object.entries(update.$set ?? {})) next[key] = value;
      for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
        if (!next[key].includes(value)) next[key].push(value);
      }
      for (const [key, value] of Object.entries(update.$pull ?? {})) next[key] = next[key].filter(item => item !== value);
      unique(next, doc._id);
      documents.set(doc._id, next);
      return { matchedCount: 1 };
    },
    deleteOne: async filter => {
      const doc = [...documents.values()].find(item => matches(item, filter));
      return { deletedCount: doc && documents.delete(doc._id) ? 1 : 0 };
    }
  };
}

test('claims enforce one owner per Ring account and one account per user', async () => {
  const db = collection();
  const store = createRingOwnershipStore(db);
  await store.initialize();
  expect(db.createIndex).toHaveBeenCalledWith({ participants: 1 }, { unique: true, name: 'unique_ring_participant' });
  const claims = await Promise.allSettled([
    store.claim('Owner@example.com', '123'),
    store.claim('other@example.com', '123')
  ]);
  expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const owner = (await store.getByRingId('123')).ownerEmail;
  await expect(store.claim(owner, '456')).rejects.toMatchObject({ status: 409 });
  await expect(store.claim(owner, '123')).resolves.toMatchObject({ ownerEmail: owner });
});

test('invitations must match the signed-in email and concurrent acceptance joins at most one account', async () => {
  const store = createRingOwnershipStore(collection());
  await store.claim('a@example.com', '1');
  await store.claim('b@example.com', '2');
  await store.invite('a@example.com', 'Member@example.com');
  await store.invite('b@example.com', 'member@example.com');
  await expect(store.accept('imposter@example.com', '1')).rejects.toMatchObject({ status: 404 });
  expect(await store.getInvitations('MEMBER@example.com')).toHaveLength(2);
  const accepted = await Promise.allSettled([
    store.accept('member@example.com', '1'), store.accept('member@example.com', '2')
  ]);
  expect(accepted.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await store.getMembership('member@example.com')).participants).toContain('member@example.com');
  await expect(store.claim('member@example.com', '3')).rejects.toMatchObject({ status: 409 });
});

test('owners can revoke members and cancel invitations but other users cannot', async () => {
  const store = createRingOwnershipStore(collection());
  await store.claim('owner@example.com', '1');
  await store.invite('owner@example.com', 'member@example.com');
  await store.accept('member@example.com', '1');
  await store.invite('owner@example.com', 'pending@example.com');
  await expect(store.remove('member@example.com', 'owner@example.com')).rejects.toMatchObject({ status: 403 });
  await store.remove('owner@example.com', 'member@example.com');
  await store.remove('owner@example.com', 'pending@example.com');
  expect(await store.getMembership('member@example.com')).toBeUndefined();
  await expect(store.accept('pending@example.com', '1')).rejects.toMatchObject({ status: 404 });
});

test('failed owner release remains blocked and retryable; successful release removes all access', async () => {
  const store = createRingOwnershipStore(collection());
  await store.claim('owner@example.com', '1');
  await store.invite('owner@example.com', 'member@example.com');
  await store.accept('member@example.com', '1');
  await store.invite('owner@example.com', 'pending@example.com');
  const disconnect = jest.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce();
  await expect(store.leave('owner@example.com', disconnect)).rejects.toThrow('database unavailable');
  expect((await store.getByRingId('1')).releasing).toBe(true);
  await expect(store.claim('owner@example.com', '1')).rejects.toMatchObject({ status: 409 });
  await expect(store.accept('pending@example.com', '1')).rejects.toMatchObject({ status: 404 });
  expect(await store.getInvitations('pending@example.com')).toEqual([]);
  await store.leave('owner@example.com', disconnect);
  expect(await store.getMembership('member@example.com')).toBeUndefined();
  expect(await store.getByRingId('1')).toBeUndefined();
  await expect(store.claim('new@example.com', '1')).resolves.toMatchObject({ ownerEmail: 'new@example.com' });
});

test('a member can leave without releasing the owner account', async () => {
  const store = createRingOwnershipStore(collection());
  await store.claim('owner@example.com', '1');
  await store.invite('owner@example.com', 'member@example.com');
  await store.accept('member@example.com', '1');
  const cleanup = jest.fn();
  await store.leave('member@example.com', cleanup);
  expect(cleanup).not.toHaveBeenCalled();
  expect(await store.getMembership('member@example.com')).toBeUndefined();
  expect((await store.getByRingId('1')).ownerEmail).toBe('owner@example.com');
});

test('membership routes use the authenticated email for invitation acceptance and hide owner details from members', async () => {
  const store = createRingOwnershipStore(collection());
  await store.claim('owner@example.com', '1');
  await store.invite('owner@example.com', 'member@example.com');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.accountEmail = req.get('x-test-user'); next(); });
  app.use('/settings/ring-access', createRingOwnershipRouter(store, { error: jest.fn() }, jest.fn()));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/settings/ring-access`;
  try {
    const impostor = await fetch(`${base}/invitations/1/accept`, {
      method: 'POST', headers: { 'x-test-user': 'impostor@example.com' }
    });
    expect(impostor.status).toBe(404);
    const accepted = await fetch(`${base}/invitations/1/accept`, {
      method: 'POST', headers: { 'x-test-user': 'member@example.com' }
    });
    expect(accepted.status).toBe(204);
    const response = await fetch(base, { headers: { 'x-test-user': 'member@example.com' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      membership: { ringAccountId: '1', ownerEmail: 'owner@example.com', role: 'member' },
      invitations: []
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
