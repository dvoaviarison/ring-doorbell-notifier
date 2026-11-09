export function createRingAccessMiddleware(ownership, logger) {
  return async (req, res, next) => {
    if (!req.accountEmail) return next();
    try {
      req.ringMembership = await ownership.getMembership(req.accountEmail);
      req.ringOwner = req.ringMembership?.ownerEmail;
      if (req.ringMembership?.releasing &&
          !(req.ringOwner === req.accountEmail && req.path.startsWith('/settings/ring-access'))) {
        return res.status(409).json({ error: 'This Ring account is being released.' });
      }
      if (req.slackAuthenticated && req.ringOwner !== req.accountEmail) {
        return res.status(403).json({ error: 'Slack commands are available only to the Ring account owner.' });
      }
      if (req.path.startsWith('/settings/slack') && req.ringOwner !== req.accountEmail) {
        return res.status(403).json({ error: 'Only a Ring account owner can manage Slack settings.' });
      }
      if (['/auth/ring/login', '/auth/ring/mfa'].includes(req.path) &&
          req.ringMembership && req.ringOwner !== req.accountEmail) {
        return res.status(403).json({ error: 'Leave your shared Ring account before connecting another.' });
      }
      next();
    } catch (error) {
      logger.error('Could not check Ring account access:', error);
      res.status(500).json({ error: 'Could not check Ring account access.' });
    }
  };
}
