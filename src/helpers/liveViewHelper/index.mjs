import { Router } from 'express';
import { findCamera } from '../ringHelper/index.mjs';

const sessionLifetimeMs = 5 * 60 * 1000;

export function createLiveViewRouter(getRingApi, logger) {
  const router = Router();
  const sessions = new Map();

  async function endSession(id) {
    const entry = sessions.get(id);
    if (!entry) return;
    sessions.delete(id);
    clearTimeout(entry.timer);
    try {
      await entry.session.end();
    } catch (error) {
      logger.error('Could not end Ring live view:', error);
    }
  }

  router.get('/battery', async (req, res) => {
    const cameraName = req.query.cameraName;
    if (typeof cameraName !== 'string' || !cameraName.trim()) {
      return res.status(400).json({ error: 'A camera name is required.' });
    }
    const api = getRingApi(req);
    if (!api) return res.status(503).json({ error: 'Ring is not connected.' });
    try {
      const camera = findCamera(await api.getLocations(), cameraName);
      if (!camera) return res.status(404).json({ error: 'Camera not found.' });
      const level = camera.batteryLevel;
      if (level !== null && (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 100)) {
        throw new Error('Ring returned an invalid battery level.');
      }
      res.set('Cache-Control', 'no-store');
      return res.json({ batteryLevel: level });
    } catch (error) {
      logger.error('Could not load Ring camera battery level:', error);
      return res.status(502).json({ error: 'Could not load camera battery level.' });
    }
  });

  router.get('/snapshot', async (req, res) => {
    const cameraName = req.query.cameraName;
    if (typeof cameraName !== 'string' || !cameraName.trim()) {
      return res.status(400).json({ error: 'A camera name is required.' });
    }
    const api = getRingApi(req);
    if (!api) return res.status(503).json({ error: 'Ring is not connected.' });
    try {
      const camera = findCamera(await api.getLocations(), cameraName);
      if (!camera) return res.status(404).json({ error: 'Camera not found.' });
      const snapshot = await camera.getSnapshot();
      res.set('Cache-Control', 'no-store');
      return res.type('image/jpeg').send(snapshot);
    } catch (error) {
      logger.error('Could not load Ring camera snapshot:', error);
      return res.status(502).json({ error: 'Could not load camera snapshot.' });
    }
  });

  router.post('/start', async (req, res) => {
    const { cameraName, sdp, sessionId } = req.body ?? {};
    if (typeof cameraName !== 'string' || !cameraName.trim() ||
        typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 100000 ||
        typeof sessionId !== 'string' || !/^[a-f\d-]{36}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A camera, WebRTC offer, and session ID are required.' });
    }
    if (sessions.has(sessionId)) return res.status(409).json({ error: 'Live session already exists.' });
    const api = getRingApi(req);
    if (!api) return res.status(503).json({ error: 'Ring is not connected.' });

    let entry;
    let disconnected = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        disconnected = true;
        if (entry && sessions.get(sessionId) === entry) void endSession(sessionId);
      }
    });
    try {
      const camera = findCamera(await api.getLocations(), cameraName);
      if (!camera) return res.status(404).json({ error: 'Camera not found.' });
      if (disconnected) return;
      if (sessions.has(sessionId)) return res.status(409).json({ error: 'Live session already exists.' });
      const session = camera.createSimpleWebRtcSession();
      entry = { session, accountEmail: req.accountEmail, timer: setTimeout(() => void endSession(sessionId), sessionLifetimeMs) };
      entry.timer.unref();
      sessions.set(sessionId, entry);
      const answer = await session.start(sdp);
      if (disconnected || sessions.get(sessionId) !== entry) {
        // A stop or expiration may have arrived before Ring finished starting.
        await session.end();
        if (!disconnected) return res.status(410).json({ error: 'Live session ended before it could start.' });
        return;
      }
      if (typeof answer !== 'string' || !answer.startsWith('v=0')) {
        throw new Error('Ring returned an invalid WebRTC answer.');
      }
      return res.json({ sdp: answer });
    } catch (error) {
      if (entry && sessions.get(sessionId) === entry) await endSession(sessionId);
      logger.error('Could not start Ring live view:', error);
      if (!disconnected && !res.headersSent) return res.status(502).json({ error: 'Could not start live view for this camera.' });
    }
  });

  router.post('/stop', async (req, res) => {
    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== 'string' || !/^[a-f\d-]{36}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A valid live session ID is required.' });
    }
    const entry = sessions.get(sessionId);
    if (entry && entry.accountEmail !== req.accountEmail) return res.sendStatus(404);
    await endSession(sessionId);
    return res.sendStatus(204);
  });

  router.post('/speaker', async (req, res) => {
    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== 'string' || !/^[a-f\d-]{36}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'A valid live session ID is required.' });
    }
    const entry = sessions.get(sessionId);
    if (!entry || entry.accountEmail !== req.accountEmail) return res.sendStatus(404);
    try {
      await entry.session.activateCameraSpeaker();
      if (sessions.get(sessionId) !== entry) return res.status(410).json({ error: 'Live session has ended.' });
      return res.sendStatus(204);
    } catch (error) {
      logger.error('Could not activate Ring camera speaker:', error);
      return res.status(502).json({ error: 'Could not activate camera speaker.' });
    }
  });

  return router;
}
