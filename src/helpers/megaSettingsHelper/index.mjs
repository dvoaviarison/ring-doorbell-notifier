import { Router } from 'express';

export function createMegaSettingsRouter({ getMegaSettings, getMegaSettingsStatus, updateMegaSettings, openMegaStorage, logger }) {
  const router = Router();

  router.get('/mega', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await getMegaSettingsStatus(req.accountEmail));
    } catch (error) {
      logger.error('Could not load MEGA settings:', error);
      res.status(500).json({ error: 'Could not load MEGA settings.' });
    }
  });

  router.get('/mega/secrets', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const settings = await getMegaSettings(req.accountEmail);
      res.json({
        email: settings?.email ?? '',
        password: settings?.password ?? ''
      });
    } catch (error) {
      logger.error('Could not load MEGA secrets:', error);
      res.status(500).json({ error: 'Could not load MEGA secrets.' });
    }
  });

  router.get('/mega/usage', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let storage;
    try {
      const credentials = await getMegaSettings(req.accountEmail);
      if (!credentials?.email || !credentials?.password) {
        return res.status(409).json({ error: 'MEGA storage is not configured.' });
      }
      storage = await openMegaStorage(credentials);
      const { spaceUsed, spaceTotal } = await storage.getAccountInfo();
      if (!Number.isFinite(spaceUsed) || spaceUsed < 0 ||
          !Number.isFinite(spaceTotal) || spaceTotal <= 0) {
        throw new Error('Invalid MEGA storage usage.');
      }
      return res.json({ spaceUsed, spaceTotal });
    } catch (error) {
      logger.error('Could not load MEGA storage usage:', error);
      return res.status(500).json({ error: 'Could not load MEGA storage usage.' });
    } finally {
      storage?.close();
    }
  });

  router.put('/mega', async (req, res) => {
    const email = req.body?.email;
    const password = req.body?.password;
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' || !password || password.length > 4096) {
      return res.status(400).json({ error: 'Enter a valid MEGA email and password.' });
    }
    try {
      await updateMegaSettings(req.accountEmail, { email: email.trim().toLowerCase(), password });
      return res.set('Cache-Control', 'no-store').json(await getMegaSettingsStatus(req.accountEmail));
    } catch (error) {
      logger.error('Could not save MEGA settings:', error);
      return res.status(500).json({ error: 'Could not save MEGA settings.' });
    }
  });

  return router;
}
