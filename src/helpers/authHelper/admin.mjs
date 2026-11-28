import { Router } from 'express';
import { normalizeMemberEmail, OwnershipError } from '../ringOwnershipHelper/index.mjs';

export function createAdminStore(collection, bootstrapEmails) {
  const bootstrap = new Set(bootstrapEmails.split(',').map(email => email.trim()).filter(Boolean).map(normalizeMemberEmail));
  return {
    async isAdmin(email) {
      const normalized = normalizeMemberEmail(email);
      return bootstrap.has(normalized) || Boolean(await collection.findOne({ _id: normalized }));
    },
    async list() {
      const records = await collection.find({}, { projection: { _id: 1 } }).toArray();
      return [...new Set([...bootstrap, ...records.map(record => record._id)])].sort();
    },
    async add(email) {
      const normalized = normalizeMemberEmail(email);
      if (!bootstrap.has(normalized)) {
        await collection.updateOne({ _id: normalized }, { $setOnInsert: { _id: normalized } }, { upsert: true });
      }
    }
  };
}

export function createAdminGuard(store, logger, allowSlack = false) {
  return async (req, res, next) => {
    if (allowSlack && req.slackAuthenticated === true) return next();
    try {
      if (req.accountEmail && await store.isAdmin(req.accountEmail)) return next();
      return res.status(403).json({ error: 'Administrator access is required.' });
    } catch (error) {
      logger.error('Could not check administrator access:', error);
      return res.status(503).json({ error: 'Could not check administrator access.' });
    }
  };
}

export function createAdminRouter(store, ownership, logger, allowedOrigins) {
  const router = Router();
  router.use(createAdminGuard(store, logger));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/tenants', async (_req, res) => {
    try {
      res.json({ tenants: await ownership.listTenants() });
    } catch (error) {
      logger.error('Could not load tenants:', error);
      res.status(500).json({ error: 'Could not load tenants.' });
    }
  });
  router.get('/admins', async (_req, res) => {
    try {
      res.json({ admins: await store.list() });
    } catch (error) {
      logger.error('Could not load administrators:', error);
      res.status(500).json({ error: 'Could not load administrators.' });
    }
  });
  router.post('/admins', async (req, res) => {
    const origin = req.get('origin');
    if (!origin || !allowedOrigins.includes(origin) || new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ error: 'Administrator request origin is invalid.' });
    }
    try {
      await store.add(req.body?.email);
      res.status(204).end();
    } catch (error) {
      if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.message });
      logger.error('Could not add administrator:', error);
      res.status(500).json({ error: 'Could not add administrator.' });
    }
  });
  return router;
}
