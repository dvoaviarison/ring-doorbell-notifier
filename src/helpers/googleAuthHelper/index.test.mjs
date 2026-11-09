import express from 'express';
import { createAccessMiddleware, createGoogleAuth, signPayload, verifySignedPayload } from './index.mjs';

const secret = 'a-test-secret-at-least-thirty-two-bytes-long';
const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_ALLOWED_ORIGINS: 'http://localhost:5173,https://a-eye-home.onrender.com',
  A_EYE_SESSION_SECRET: secret
};

describe('Google authentication', () => {
  let server;
  let url;
  let identity;
  let clientFactory;
  let verifyIdToken;

  beforeEach(async () => {
    identity = { sub: 'subject', email: 'User@example.com', email_verified: true, picture: 'https://example.com/avatar.png' };
    verifyIdToken = jest.fn(async () => ({ getPayload: () => identity }));
    clientFactory = jest.fn((_id, _secret, redirect) => ({
      generateAuthUrl: ({ state }) => `https://accounts.google.com/?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,
      getToken: async () => ({ tokens: { id_token: 'test-token' } }),
      verifyIdToken
    }));
    const app = express();
    app.use((req, _res, next) => {
      req.headers.host = req.headers['x-test-host'];
      next();
    });
    const auth = createGoogleAuth({ ...env, GOOGLE_ALLOWED_EMAILS: 'someone-else@example.com' }, { error: jest.fn() }, clientFactory);
    auth.setup(app);
    app.use(auth.middleware);
    app.get('/events', (req, res) => res.json({ ok: true, email: req.accountEmail }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  });

  async function startLogin(host) {
    const response = await fetch(`${url}/auth/google`, { headers: { 'x-test-host': host }, redirect: 'manual' });
    const location = new URL(response.headers.get('location'));
    return { response, state: location.searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0], redirect: location.searchParams.get('redirect_uri') };
  }

  test('signs and validates expiring sessions', () => {
    const now = 1800000000000;
    const token = signPayload({ exp: now / 1000 + 60 }, secret);
    expect(verifySignedPayload(token, secret, now)).toBeDefined();
    expect(verifySignedPayload(token, secret, now + 60000)).toBeUndefined();
    expect(verifySignedPayload(token, 'wrong secret', now)).toBeUndefined();
  });

  test('rejects missing configuration and unsafe origins', () => {
    expect(() => createGoogleAuth({ ...env, GOOGLE_ALLOWED_ORIGINS: 'http://example.com' }, console)).toThrow();
    expect(() => createGoogleAuth({ ...env, GOOGLE_CLIENT_ID: '' }, console)).toThrow();
    expect(() => createGoogleAuth({ ...env, A_EYE_SESSION_SECRET: 'short' }, console)).toThrow();
    expect(() => createGoogleAuth(env, console)).not.toThrow();
  });

  test('allows only account-bound Slack capture requests to bypass Google authentication', async () => {
    const auth = { middleware: jest.fn() };
    const verify = jest.fn(req => req.headers['x-slack-signature'] === 'valid' ? 'user@example.com' : undefined);
    const gate = createAccessMiddleware(auth, verify);
    const next = jest.fn();
    gate({ path: '/health', method: 'GET', headers: {} }, {}, next);
    const capture = { path: '/capture', method: 'POST', headers: { 'x-slack-signature': 'valid' } };
    await gate(capture, {}, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(capture.accountEmail).toBe('user@example.com');
    expect(capture.slackAuthenticated).toBe(true);
    await gate({ path: '/capture', method: 'POST', headers: { 'x-slack-signature': 'invalid' } }, {}, next);
    gate({ path: '/events', method: 'GET', headers: { 'x-slack-signature': 'valid' } }, {}, next);
    expect(auth.middleware).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['localhost:5173', 'http://localhost:5173', false],
    ['a-eye-home.onrender.com', 'https://a-eye-home.onrender.com', true]
  ])('authenticates %s and protects backend routes', async (host, origin, secure) => {
    const blocked = await fetch(`${url}/events`, { headers: { 'x-test-host': host } });
    expect(blocked.status).toBe(401);
    expect(blocked.headers.get('x-a-eye-auth')).toBe('required');
    const { response, state, cookie, redirect } = await startLogin(host);
    expect(redirect).toBe(`${origin}/auth/google/callback`);
    expect(response.headers.get('set-cookie').includes('Secure')).toBe(secure);
    const callback = await fetch(`${url}/auth/google/callback?state=${state}&code=abc`, {
      headers: { 'x-test-host': host, cookie }, redirect: 'manual'
    });
    expect(callback.headers.get('location')).toBe('/');
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'test-token', audience: 'client-id' });
    const setCookies = callback.headers.get('set-cookie');
    expect(setCookies.includes('Secure')).toBe(secure);
    const session = setCookies.match(/a_eye_session=([^;,]+)/)[0];
    const allowed = await fetch(`${url}/events`, { headers: { 'x-test-host': host, cookie: session } });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true, email: 'user@example.com' });
    const status = await fetch(`${url}/auth/session`, { headers: { 'x-test-host': host, cookie: session } });
    expect(await status.json()).toEqual({ authenticated: true, email: 'user@example.com', picture: 'https://example.com/avatar.png' });
    expect((await fetch(`${url}/auth/logout`, { method: 'POST', headers: { 'x-test-host': host, origin: 'https://attacker.example', cookie: session } })).status).toBe(403);
    expect((await fetch(`${url}/auth/logout`, { method: 'POST', headers: { 'x-test-host': host, origin, cookie: session } })).status).toBe(204);
  });

  test('rejects unapproved hosts and state replay across origins', async () => {
    expect((await fetch(`${url}/auth/google`, { headers: { 'x-test-host': 'attacker.example' }, redirect: 'manual' })).status).toBe(400);
    const { state, cookie } = await startLogin('localhost:5173');
    const replay = await fetch(`${url}/auth/google/callback?state=${state}&code=abc`, {
      headers: { 'x-test-host': 'a-eye-home.onrender.com', cookie }, redirect: 'manual'
    });
    expect(replay.headers.get('location')).toBe('/?authError=state');
  });

  test('accepts a verified account even when a legacy allowlist would exclude it', async () => {
    identity.email = ' Other@Example.com ';
    const { state, cookie } = await startLogin('localhost:5173');
    const callback = await fetch(`${url}/auth/google/callback?state=${state}&code=abc`, {
      headers: { 'x-test-host': 'localhost:5173', cookie }, redirect: 'manual'
    });
    expect(callback.headers.get('location')).toBe('/');
    const session = callback.headers.get('set-cookie').match(/a_eye_session=([^;,]+)/)[0];
    const response = await fetch(`${url}/events`, { headers: { 'x-test-host': 'localhost:5173', cookie: session } });
    expect(await response.json()).toEqual({ ok: true, email: 'other@example.com' });
    expect(() => createGoogleAuth({ ...env, GOOGLE_ALLOWED_EMAILS: 'someone-else@example.com' }, console)).not.toThrow();
  });

  test('does not expose a non-HTTPS Google profile picture', async () => {
    identity.picture = 'http://example.com/avatar.png';
    const { state, cookie } = await startLogin('localhost:5173');
    const callback = await fetch(`${url}/auth/google/callback?state=${state}&code=abc`, {
      headers: { 'x-test-host': 'localhost:5173', cookie }, redirect: 'manual'
    });
    const session = callback.headers.get('set-cookie').match(/a_eye_session=([^;,]+)/)[0];
    const status = await fetch(`${url}/auth/session`, {
      headers: { 'x-test-host': 'localhost:5173', cookie: session }
    });
    expect(await status.json()).toEqual({ authenticated: true, email: 'user@example.com' });
  });

  test.each([
    [{ sub: 'subject', email: 'user@example.com', email_verified: false }],
    [{ sub: 'subject', email: 'user@example.com' }],
    [{ sub: 'subject', email: ' ', email_verified: true }],
    [{ sub: '', email: 'user@example.com', email_verified: true }]
  ])('rejects an incomplete or unverified Google identity', async (invalidIdentity) => {
    identity = invalidIdentity;
    const { state, cookie } = await startLogin('localhost:5173');
    const response = await fetch(`${url}/auth/google/callback?state=${state}&code=abc`, {
      headers: { 'x-test-host': 'localhost:5173', cookie }, redirect: 'manual'
    });
    expect(response.headers.get('location')).toBe('/?authError=notAllowed');
    expect(response.headers.get('set-cookie')).not.toContain('a_eye_session=');
  });

  test('does not create a session when Google token verification fails', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));
    const { state, cookie } = await startLogin('localhost:5173');
    const response = await fetch(`${url}/auth/google/callback?state=${state}&code=abc`, {
      headers: { 'x-test-host': 'localhost:5173', cookie }, redirect: 'manual'
    });
    expect(response.headers.get('location')).toBe('/?authError=failed');
    expect(response.headers.get('set-cookie')).not.toContain('a_eye_session=');
  });

  test('rejects forged and expired sessions', async () => {
    for (const token of [
      signPayload({ sub: 'subject', email: 'user@example.com', exp: Date.now() / 1000 + 60 }, 'wrong secret'),
      signPayload({ sub: 'subject', email: 'user@example.com', exp: Date.now() / 1000 - 1 }, secret),
      signPayload({ sub: 'subject', email: '', exp: Date.now() / 1000 + 60 }, secret)
    ]) {
      const response = await fetch(`${url}/events`, { headers: { 'x-test-host': 'localhost:5173', cookie: `a_eye_session=${token}` } });
      expect(response.status).toBe(401);
    }
  });
});
