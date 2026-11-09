import express from 'express';
import { createSlackSettingsRouter } from './index.mjs';

test('settings use the signed-in account and never return saved secrets', async () => {
  const saved = new Map([
    ['first@example.com', { channelId: 'C1', botToken: 'secret-token', signingSecret: 'secret-signing' }],
    ['second@example.com', { channelId: 'C2', botToken: 'other-token' }]
  ]);
  const getSlackSettings = jest.fn(async email => saved.get(email));
  const updateSlackSettings = jest.fn(async (email, patch) => saved.set(email, { ...saved.get(email), ...patch }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.accountEmail = req.get('x-test-user'); next(); });
  app.use('/settings', createSlackSettingsRouter({ getSlackSettings, updateSlackSettings, logger: { error: jest.fn() } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/settings/slack`;
  try {
    const first = await fetch(url, { headers: { 'x-test-user': 'first@example.com' } });
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.json()).toEqual({ channelId: 'C1', hasBotToken: true, hasSigningSecret: true });
    const second = await fetch(url, { headers: { 'x-test-user': 'second@example.com' } });
    expect(await second.json()).toEqual({ channelId: 'C2', hasBotToken: true, hasSigningSecret: false });
    const update = await fetch(url, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': 'first@example.com' },
      body: JSON.stringify({ channelId: 'C3', botToken: '', signingSecret: '' })
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ channelId: 'C3', hasBotToken: true, hasSigningSecret: true });
    expect(updateSlackSettings).toHaveBeenCalledWith('first@example.com', { channelId: 'C3' });
    expect(saved.get('first@example.com').botToken).toBe('secret-token');
    expect(saved.get('second@example.com').channelId).toBe('C2');
    const invalid = await fetch(url, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': 'first@example.com' },
      body: JSON.stringify({ channelId: {}, botToken: 'new-token' })
    });
    expect(invalid.status).toBe(400);
    expect(updateSlackSettings).toHaveBeenCalledTimes(1);
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});
