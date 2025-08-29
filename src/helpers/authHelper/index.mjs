import passport from 'passport';
import crypto from 'crypto';
import { logger } from '../logHelper/index.mjs';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';

const callbackURL = `${process.env.APP_SERVER_URL || ''}/auth/google/callback`;

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: callbackURL
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

export function setupSession(app) {
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  }));
  app.use(passport.initialize());
  app.use(passport.session());
}

export function setupAuth(app, logger) {
  // Start Google OAuth flow
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  // Handle Google OAuth callback
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/google' }),
    (req, res) => {
      logger.info(`User signed in: ${req.user.displayName} (${req.user.emails?.[0]?.value})`);
      res.redirect('/');
    }
  );
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

  if (req.isAuthenticated()) {
    return next();
  }

  res.redirect('/auth/google');
}

export function authMiddleware(req, res, next) {
  const publicPaths = ['/auth/google', '/public', '/health'];
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

export function rawBodyMiddleware(req, res, next) {
  req.rawBody = '';
  req.on('data', (chunk) => {
    req.rawBody += chunk.toString();
  });
  req.on('end', () => {
    next();
  });
};