import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

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

  // Authentication middleware
  function ensureAuthenticated(req, res, next) {
    // Bypass Google auth for Slack bot requests
    if (req.headers['x-slack-bot-token'] === process.env.SLACK_BOT_TOKEN) {
      return next();
    }
    if (req.isAuthenticated()) return next();
    res.redirect('/auth/google');
  }

  // Protect all routes except auth and static assets
  app.use((req, res, next) => {
    if (
      req.path.startsWith('/auth/google') ||
      req.path.startsWith('/public') ||
      req.path.startsWith('/favicon.ico')
    ) {
      return next();
    }
    ensureAuthenticated(req, res, next);
  });
}