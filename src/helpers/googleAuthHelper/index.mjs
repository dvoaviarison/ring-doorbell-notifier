import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const sessionCookie = 'a_eye_session';
const stateCookie = 'a_eye_oauth_state';
const sessionAge = 8 * 60 * 60;
const stateAge = 10 * 60;

export function signPayload(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

export function verifySignedPayload(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return undefined;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra !== undefined) return undefined;
  const expected = createHmac('sha256', secret).update(encoded).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number' || payload.exp <= now / 1000) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export function createAccessMiddleware(auth, isSlackRequestValid) {
  return (req, res, next) => {
    if (req.path === '/health' && ['GET', 'POST'].includes(req.method)) return next();
    if (req.path === '/capture' && req.method === 'POST' && req.headers['x-slack-signature']) {
      return Promise.resolve(isSlackRequestValid(req)).then(email => {
        if (typeof email === 'string' && email) {
          req.accountEmail = email;
          req.slackAuthenticated = true;
          return next();
        }
        return auth.middleware(req, res, next);
      }).catch(next);
    }
    return auth.middleware(req, res, next);
  };
}

function getCookie(req, name) {
  const prefix = `${name}=`;
  const value = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(prefix))?.slice(prefix.length);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function createGoogleAuth(env, logger, clientFactory = (id, secret, redirect) => new OAuth2Client(id, secret, redirect)) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, A_EYE_SESSION_SECRET: secret } = env;
  const origins = (env.GOOGLE_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const url = new URL(value);
    if (url.origin !== value || !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('GOOGLE_ALLOWED_ORIGINS must contain HTTPS origins or HTTP localhost origins only.');
    }
    return url;
  });
  if (!clientId || !clientSecret || origins.length === 0 ||
      !secret || Buffer.byteLength(secret) < 32) {
    throw new Error('Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_ORIGINS, and A_EYE_SESSION_SECRET (at least 32 bytes).');
  }
  if (new Set(origins.map(origin => origin.host)).size !== origins.length) {
    throw new Error('GOOGLE_ALLOWED_ORIGINS must not contain duplicate hosts.');
  }

  function getOrigin(req) {
    return origins.find(origin => origin.host === req.get('host'));
  }

  function cookieOptions(origin, maxAge) {
    return { httpOnly: true, secure: origin.protocol === 'https:', sameSite: 'lax', path: '/', ...(maxAge ? { maxAge: maxAge * 1000 } : {}) };
  }

  function getUser(req) {
    const payload = verifySignedPayload(getCookie(req, sessionCookie), secret);
    if (typeof payload?.sub !== 'string' || !payload.sub.trim() ||
        typeof payload.email !== 'string' || !payload.email.trim()) return undefined;
    return payload;
  }

  function setup(app) {
    app.get('/auth/session', (req, res) => {
      const user = getUser(req);
      res.set('Cache-Control', 'no-store').json(user ? { authenticated: true, email: user.email } : { authenticated: false });
    });

    app.get('/auth/google', (req, res) => {
      const origin = getOrigin(req);
      if (!origin) return res.status(400).send('Unrecognized frontend origin.');
      const redirect = `${origin.origin}/auth/google/callback`;
      const state = randomBytes(32).toString('base64url');
      res.cookie(stateCookie, signPayload({ state, redirect, exp: Math.floor(Date.now() / 1000) + stateAge }, secret), cookieOptions(origin, stateAge));
      const client = clientFactory(clientId, clientSecret, redirect);
      return res.redirect(client.generateAuthUrl({ access_type: 'online', prompt: 'select_account', scope: ['openid', 'email', 'profile'], state }));
    });

    app.get('/auth/google/callback', async (req, res) => {
      const origin = getOrigin(req);
      if (!origin) return res.status(400).send('Unrecognized frontend origin.');
      const payload = verifySignedPayload(getCookie(req, stateCookie), secret);
      res.clearCookie(stateCookie, cookieOptions(origin));
      const state = typeof req.query.state === 'string' ? Buffer.from(req.query.state) : Buffer.alloc(0);
      const expected = typeof payload?.state === 'string' ? Buffer.from(payload.state) : Buffer.alloc(0);
      const redirect = `${origin.origin}/auth/google/callback`;
      if (!expected.length || state.length !== expected.length || !timingSafeEqual(state, expected) || payload.redirect !== redirect) {
        return res.redirect('/?authError=state');
      }
      if (typeof req.query.error === 'string') return res.redirect('/?authError=cancelled');
      if (typeof req.query.code !== 'string') return res.redirect('/?authError=failed');
      try {
        const client = clientFactory(clientId, clientSecret, redirect);
        const { tokens } = await client.getToken(req.query.code);
        if (!tokens.id_token) throw new Error('Google did not return an ID token.');
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
        const identity = ticket.getPayload();
        const email = typeof identity?.email === 'string' ? identity.email.trim().toLowerCase() : '';
        if (typeof identity?.sub !== 'string' || !identity.sub.trim() || !email || identity.email_verified !== true) {
          return res.redirect('/?authError=notAllowed');
        }
        res.cookie(sessionCookie, signPayload({ sub: identity.sub, email, exp: Math.floor(Date.now() / 1000) + sessionAge }, secret), cookieOptions(origin, sessionAge));
        return res.redirect('/');
      } catch (error) {
        logger.error('Google sign-in failed:', error);
        return res.redirect('/?authError=failed');
      }
    });

    app.post('/auth/logout', (req, res) => {
      const origin = getOrigin(req);
      if (!origin || req.get('origin') !== origin.origin) return res.status(403).json({ error: 'Sign-out request origin is invalid.' });
      res.clearCookie(sessionCookie, cookieOptions(origin));
      return res.status(204).end();
    });
  }

  function middleware(req, res, next) {
    const user = getUser(req);
    if (user) {
      req.accountEmail = user.email.toLowerCase();
      return next();
    }
    res.set('X-A-Eye-Auth', 'required').status(401).json({ error: 'Sign in with a verified Google account to continue.' });
  }

  return { setup, middleware };
}
