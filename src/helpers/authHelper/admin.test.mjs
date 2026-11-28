import express from 'express';
import { createGoogleAuth, signPayload } from './google.mjs';
import { createAdminStore, createAdminGuard, createAdminRouter } from './admin.mjs';

test('admin grants persist and protect tenant data, grant management, and capture', async () => {
  const records = new Map();
  const collection = {
    findOne: async ({ _id }) => records.get(_id),
    find: () => ({ toArray: async () => [...records.values()] }),
    updateOne: async ({ _id }) => { records.set(_id, { _id }); }
  };
  const store = createAdminStore(collection, ' Admin@example.com ');
  const ownership = { listTenants: jest.fn(async () => [
    { ringAccountId: '1', ownerEmail: 'owner@example.com', participants: ['member@example.com'], invitations: ['pending@example.com'] }
  ]) };
  const secret = 'a-test-secret-at-least-thirty-two-bytes-long';
  const logger = { error: jest.fn() };
  const app = express();
  app.use((req, _res, next) => { req.headers.host = req.headers['x-test-host']; next(); });
  app.use(express.json());
  const auth = createGoogleAuth({
    GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_ALLOWED_ORIGINS: 'http://localhost:5173', A_EYE_SESSION_SECRET: secret
  }, logger, undefined, store.isAdmin);
  auth.setup(app);
  app.use(auth.middleware);
  app.use('/settings/admin', createAdminRouter(store, ownership, logger, ['http://localhost:5173']));
  app.post('/capture', createAdminGuard(store, logger, true), (_req, res) => res.status(204).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = email => `a_eye_session=${signPayload({ sub: email, email, exp: Date.now() / 1000 + 60 }, secret)}`;
  const request = (path, email, options = {}) => fetch(base + path, {
    ...options,
    headers: { 'x-test-host': 'localhost:5173', ...(email ? { cookie: cookie(email) } : {}), ...options.headers }
  });
  try {
    expect((await request('/settings/admin/tenants')).status).toBe(401);
    for (const path of ['/settings/admin/tenants', '/settings/admin/admins']) {
      expect((await request(path, 'member@example.com')).status).toBe(403);
    }
    expect((await request('/settings/admin/admins', 'member@example.com', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'member@example.com' })
    })).status).toBe(403);
    expect((await request('/capture', 'member@example.com', { method: 'POST' })).status).toBe(403);
    expect((await request('/capture', 'admin@example.com', { method: 'POST' })).status).toBe(204);
    const tenants = await request('/settings/admin/tenants', 'admin@example.com');
    expect(tenants.headers.get('cache-control')).toBe('no-store');
    expect(await tenants.json()).toEqual({ tenants: await ownership.listTenants() });
    expect((await request('/settings/admin/admins', 'admin@example.com', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'invalid' })
    })).status).toBe(400);
    for (const origin of [undefined, 'http://attacker.example']) {
      expect((await request('/settings/admin/admins', 'admin@example.com', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ email: 'attacker@example.com' })
      })).status).toBe(403);
    }
    const add = () => request('/settings/admin/admins', 'admin@example.com', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ email: ' New@Example.com ' })
    });
    expect((await add()).status).toBe(204);
    expect((await add()).status).toBe(204);
    expect(await (await request('/settings/admin/admins', 'new@example.com')).json()).toEqual({
      admins: ['admin@example.com', 'new@example.com']
    });
    expect((await (await request('/auth/session', 'new@example.com')).json()).isAdmin).toBe(true);
    expect(await createAdminStore(collection, 'admin@example.com').isAdmin('NEW@example.com')).toBe(true);
    expect((await request('/capture', 'new@example.com', { method: 'POST' })).status).toBe(204);
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});

test('admin check fails closed and only verified Slack capture bypasses it', async () => {
  const logger = { error: jest.fn() };
  const store = { isAdmin: jest.fn().mockRejectedValue(new Error('database unavailable')) };
  const guard = createAdminGuard(store, logger, true);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await guard({ accountEmail: 'user@example.com' }, res, next);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
  await guard({ slackAuthenticated: true }, res, next);
  expect(next).toHaveBeenCalledTimes(1);
});
