import { Router } from 'express';

export function createSlackSettingsRouter({ getSlackSettings, updateSlackSettings, logger }) {
  const router = Router();
  const describe = settings => ({
    channelId: settings?.channelId ?? '',
    hasBotToken: Boolean(settings?.botToken),
    hasSigningSecret: Boolean(settings?.signingSecret)
  });

  router.get('/slack', async (req, res) => {
    try {
      const settings = await getSlackSettings(req.accountEmail);
      res.set('Cache-Control', 'no-store').json(describe(settings));
    } catch (error) {
      logger.error('Could not load Slack settings:', error);
      res.status(500).json({ error: 'Could not load Slack settings.' });
    }
  });

  router.put('/slack', async (req, res) => {
    const { channelId, botToken, signingSecret } = req.body ?? {};
    if (typeof channelId !== 'string' || channelId.length > 255 ||
        (botToken !== undefined && (typeof botToken !== 'string' || botToken.length > 4096)) ||
        (signingSecret !== undefined && (typeof signingSecret !== 'string' || signingSecret.length > 4096))) {
      return res.status(400).json({ error: 'Enter valid Slack settings.' });
    }
    const patch = {
      channelId: channelId.trim(),
      ...(botToken?.trim() ? { botToken: botToken.trim() } : {}),
      ...(signingSecret?.trim() ? { signingSecret: signingSecret.trim() } : {})
    };
    try {
      await updateSlackSettings(req.accountEmail, patch);
      const settings = await getSlackSettings(req.accountEmail);
      return res.set('Cache-Control', 'no-store').json(describe(settings));
    } catch (error) {
      logger.error('Could not save Slack settings:', error);
      return res.status(500).json({ error: 'Could not save Slack settings.' });
    }
  });

  return router;
}
