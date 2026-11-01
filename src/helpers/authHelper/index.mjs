import crypto from 'crypto';
import { logger } from '../logHelper/index.mjs';
import session from 'express-session';
import { RingRestClient } from 'ring-client-api/rest-client';
import { updateEnvValue } from '../fileHelper/index.mjs';
import { storeRefreshToken } from '../dbHelper/index.mjs';
import { fileURLToPath } from 'url';

export function setupSession(app) {
  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  if (!process.env.SESSION_SECRET) {
    logger.warn('SESSION_SECRET is not configured. Using a temporary secret; sessions will be invalidated when the server restarts.');
  }

  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  }));
}

const pendingRingLogins = new Map();
const loginTimeoutMs = 10 * 60 * 1000;

export function setupAuth(app, logger, onRingLogin) {
  app.get('/login', (_req, res) => {
    res.sendFile(fileURLToPath(new URL('../../public/login.html', import.meta.url)));
  });

  app.get('/auth/ring/status', (req, res) => {
    res.json({ authenticated: req.session.ringAuthenticated === true });
  });

  app.post('/auth/ring/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Ring email and password are required.' });
    }

    const client = new RingRestClient({ email: email.trim(), password });
    try {
      await client.getAuth();
      return await completeRingLogin(req, res, client, onRingLogin);
    } catch (error) {
      if (client.using2fa) {
        req.session.ringMfaPending = true;
        const sessionId = req.sessionID;
        const pending = {
          client,
          expiresAt: Date.now() + loginTimeoutMs,
          timeout: undefined
        };
        pending.timeout = setTimeout(() => {
          if (pendingRingLogins.get(sessionId) === pending) clearPendingRingLogin(sessionId);
        }, loginTimeoutMs);
        pending.timeout.unref?.();
        pendingRingLogins.set(req.sessionID, pending);
        return res.json({
          requiresMfa: true,
          prompt: client.promptFor2fa || 'Enter the verification code sent by Ring.'
        });
      }

      logger.warn('Ring login failed.');
      return res.status(401).json({ error: 'Ring login failed. Check your credentials and try again.' });
    }
  });

  app.post('/auth/ring/mfa', async (req, res) => {
    const { code } = req.body ?? {};
    const pending = pendingRingLogins.get(req.sessionID);
    if (!pending || pending.expiresAt < Date.now()) {
      clearPendingRingLogin(req.sessionID);
      return res.status(400).json({ error: 'Your login session expired. Start again.' });
    }
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Enter the Ring verification code.' });
    }

    try {
      await pending.client.getAuth(code.trim());
      clearPendingRingLogin(req.sessionID);
      return await completeRingLogin(req, res, pending.client, onRingLogin);
    } catch (error) {
      if (pending.client.using2fa) {
        pending.expiresAt = Date.now() + loginTimeoutMs;
        clearTimeout(pending.timeout);
        const sessionId = req.sessionID;
        pending.timeout = setTimeout(() => {
          if (pendingRingLogins.get(sessionId) === pending) clearPendingRingLogin(sessionId);
        }, loginTimeoutMs);
        pending.timeout.unref?.();
        return res.status(401).json({
          requiresMfa: true,
          error: 'The verification code was not accepted. Try again.',
          prompt: pending.client.promptFor2fa
        });
      }

      clearPendingRingLogin(req.sessionID);
      logger.warn('Ring MFA login failed.');
      return res.status(401).json({ error: 'Ring authentication failed. Start again.' });
    }
  });

  app.post('/auth/ring/logout', (req, res, next) => {
    clearPendingRingLogin(req.sessionID);
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('connect.sid');
      res.status(204).end();
    });
  });
}

function clearPendingRingLogin(sessionId) {
  const pending = pendingRingLogins.get(sessionId);
  if (pending) clearTimeout(pending.timeout);
  pendingRingLogins.delete(sessionId);
}

async function completeRingLogin(req, res, client, onRingLogin) {
  if (!client.refreshToken) {
    return res.status(502).json({ error: 'Ring did not return a refresh token. Try again.' });
  }

  try {
    await storeRefreshToken(client.refreshToken);
    updateEnvValue('RING_REFRESH_TOKEN', client.refreshToken);
    await onRingLogin(client.refreshToken);
  } catch (error) {
    logger.error('Ring token could not be saved or the service could not be initialized:', error);
    return res.status(500).json({ error: 'Could not save your Ring login or start the notifier. Check server logs.' });
  }

  return new Promise((resolve) => {
    req.session.regenerate((error) => {
      if (error) {
        logger.error('Could not establish an authenticated session:', error);
        return resolve(res.status(500).json({ error: 'Login succeeded, but the session could not be created.' }));
      }
      req.session.ringAuthenticated = true;
      resolve(res.json({ authenticated: true }));
    });
  });
}

function isSlackRequestValid(req) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    logger.warn('SLACK_SIGNING_SECRET is not set. Cannot verify Slack requests.');
    return false;
  }

  const slackSignature = req.headers['x-slack-signature'];
  const requestTimestamp = req.headers['x-slack-request-timestamp'];
  const rawBody = req.rawBody; // Requires raw body middleware

  if (!slackSignature || !requestTimestamp || !rawBody) {
    return false;
  }

  // Prevent replay attacks by checking if the request is older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTimestamp) > 300) {
    logger.warn('Slack request timestamp is too old. Possible replay attack.');
    return false;
  }

  const sigBasestring = `v0:${requestTimestamp}:${rawBody}`;
  const mySignature = 'v0=' +
    crypto.createHmac('sha256', signingSecret)
          .update(sigBasestring, 'utf8')
          .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(slackSignature, 'utf8'));
}

function ensureAuthenticated(req, res, next) {
  // Bypass Google auth for Slack bot requests
  if (isSlackRequestValid(req)) {
    logger.info('Bypassing auth for Slack bot request');
    return next();
  }

  if (req.session?.ringAuthenticated === true) {
    return next();
  }

  res.redirect('/login');
}

export function authMiddleware(req, res, next) {
  const publicPaths = ['/auth/ring/', '/login', '/public', '/health'];
  const publicFiles = ['/favicon.ico', '/manifest.json', '/robots.txt'];
  const publicExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot'];

  const isPublicPath = publicPaths.some(path => req.path.startsWith(path));
  const isPublicFile = publicFiles.includes(req.path);
  const isPublicExtension = publicExtensions.some(ext => req.path.endsWith(ext));
  
  if (isPublicPath || isPublicFile || isPublicExtension) {
    return next();
  }

  ensureAuthenticated(req, res, next);
}
