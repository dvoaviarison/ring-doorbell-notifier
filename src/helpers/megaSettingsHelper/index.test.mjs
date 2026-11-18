import express from 'express';
import { createMegaSettingsRouter } from './index.mjs';

test('MEGA settings expose only status unless the owner explicitly loads saved credentials', async () => {
  const getMegaSettings = jest.fn(async () => ({ email: 'owner@example.com', password: 'owner-password' }));
  const getMegaSettingsStatus = jest.fn(async () => ({ hasCredentials: true }));
  const updateMegaSettings = jest.fn();
  const logger = { error: jest.fn() };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.accountEmail = req.get('x-test-user'); next(); });
  app.use('/settings', createMegaSettingsRouter({
    getMegaSettings, getMegaSettingsStatus, updateMegaSettings, logger
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/settings/mega`;

  try {
    const status = await fetch(url, { headers: { 'x-test-user': 'owner@example.com' } });
    expect(status.headers.get('cache-control')).toBe('no-store');
    expect(await status.json()).toEqual({ hasCredentials: true });
    expect(getMegaSettings).not.toHaveBeenCalled();

    const secrets = await fetch(`${url}/secrets`, { headers: { 'x-test-user': 'owner@example.com' } });
    expect(secrets.headers.get('cache-control')).toBe('no-store');
    expect(await secrets.json()).toEqual({ email: 'owner@example.com', password: 'owner-password' });
    expect(getMegaSettings).toHaveBeenCalledWith('owner@example.com');

    const update = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'owner@example.com' },
      body: JSON.stringify({ email: ' Owner@Example.com ', password: 'new-password' })
    });
    expect(update.status).toBe(200);
    expect(updateMegaSettings).toHaveBeenCalledWith('owner@example.com', {
      email: 'owner@example.com', password: 'new-password'
    });

    const invalid = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'owner@example.com' },
      body: JSON.stringify({ email: 'not-an-email', password: 'password' })
    });
    expect(invalid.status).toBe(400);

  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});
