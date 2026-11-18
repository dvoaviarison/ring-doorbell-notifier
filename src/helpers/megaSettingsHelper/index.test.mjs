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

test('MEGA usage loads the owner account and closes the storage session on success or failure', async () => {
  const credentials = { email: 'owner@example.com', password: 'owner-password' };
  const getMegaSettings = jest.fn().mockResolvedValue(credentials);
  const storage = { getAccountInfo: jest.fn().mockResolvedValue({ spaceUsed: 450, spaceTotal: 1000 }), close: jest.fn() };
  const openMegaStorage = jest.fn().mockResolvedValue(storage);
  const logger = { error: jest.fn() };
  const app = express();
  app.use((req, _res, next) => { req.accountEmail = 'owner@example.com'; next(); });
  app.use('/settings', createMegaSettingsRouter({ getMegaSettings, openMegaStorage, logger }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/settings/mega/usage`;

  try {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ spaceUsed: 450, spaceTotal: 1000 });
    expect(getMegaSettings).toHaveBeenCalledWith('owner@example.com');
    expect(openMegaStorage).toHaveBeenCalledWith(credentials);
    expect(storage.close).toHaveBeenCalledTimes(1);

    storage.getAccountInfo.mockRejectedValueOnce(new Error('MEGA unavailable'));
    expect((await fetch(url)).status).toBe(500);
    expect(storage.close).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();

    storage.getAccountInfo.mockResolvedValueOnce({ spaceUsed: 1, spaceTotal: 0 });
    expect((await fetch(url)).status).toBe(500);
    expect(storage.close).toHaveBeenCalledTimes(3);

    getMegaSettings.mockResolvedValueOnce(null);
    expect((await fetch(url)).status).toBe(409);
    expect(openMegaStorage).toHaveBeenCalledTimes(3);
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});
