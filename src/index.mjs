import dotenv from 'dotenv';
import { run } from './app.mjs';
import { logger } from './helpers/logHelper/index.mjs';
import { purgeLocalFiles } from './helpers/fileHelper/index.mjs';
import { getLoggedInRingApi, findCamera } from './helpers/ringHelper/index.mjs';
import { handleRingNotification } from './ringNotificationHandler/index.mjs';
import { contextMiddleware } from './helpers/contextHelper/index.mjs';
import { setupAuth, setupSession, authMiddleware, resolveSlackAccount } from './helpers/authHelper/index.mjs';
import { createAccessMiddleware, createGoogleAuth } from './helpers/googleAuthHelper/index.mjs';
import { setupApiDocs } from './helpers/apiDocsHelper/index.mjs';
import {
  deletePushSubscription,
  getVideoEventMegaLink,
  getVideoEventThumbnailLink,
  getVideoEventsForDay,
  storePushSubscription,
  getSlackSettings,
  updateSlackSettings,
  getSlackSigningCandidates,
  listRingAccounts,
  storeRefreshToken,
  deleteAccountRefreshToken,
  getRingOwnershipCollection
} from './helpers/dbHelper/index.mjs';
import { getPushConfiguration } from './helpers/pushNotificationHelper/index.mjs';
import { openMegaFileStream } from './helpers/videoStreamHelper/index.mjs';
import { createLiveViewRouter } from './helpers/liveViewHelper/index.mjs';
import { createAccountRingManager } from './helpers/accountRingHelper/index.mjs';
import { createSlackSettingsRouter } from './helpers/slackSettingsHelper/index.mjs';
import { createRingOwnershipRouter, createRingOwnershipStore } from './helpers/ringOwnershipHelper/index.mjs';
import { createRingAccessMiddleware } from './helpers/ringOwnershipHelper/access.mjs';
import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env' });
const { env } = process;
const app = express();
app.set('trust proxy', 1);
const port = env.APP_SERVER_PORT;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiSpec = JSON.parse(readFileSync(path.join(__dirname, 'openapi.json'), 'utf8'));
const ownership = createRingOwnershipStore(await getRingOwnershipCollection());
await ownership.initialize();
const ringAccounts = createAccountRingManager({
  createApi: getLoggedInRingApi, run, logger,
  saveToken: storeRefreshToken, ownership
});

async function capture(cameraName, ownerEmail, recipients) {
  const ringApi = ringAccounts.get(ownerEmail);
  const ringAccountId = ringAccounts.getRingAccountId(ownerEmail);
  if (!ringApi) {
    throw new Error('Ring is not authenticated yet. Sign in to Ring first.');
  }
  logger.info(`Capture on demand request received for ${cameraName}`);
  const locations = await ringApi.getLocations();
  const camera = findCamera(locations, cameraName);
  if (!camera) throw new Error('Camera not found.');
  const notif = { android_config: { body: `There is a motion at your ${camera.name}` } };
  const notification = await handleRingNotification(camera, notif, recipients, ringAccountId);
  purgeLocalFiles();
  return notification;
}

const captureRawBody = (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); };
app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody }));

const googleAuth = createGoogleAuth(env, logger);
googleAuth.setup(app);
app.use(createAccessMiddleware(googleAuth, req => resolveSlackAccount(req, async () =>
  await getSlackSigningCandidates(), logger)));

// Configure session and Ring authentication
setupSession(app);
app.use(createRingAccessMiddleware(ownership, logger));
app.use((req, res, next) => authMiddleware(req, res, next, () => Boolean(ringAccounts.get(req.ringOwner))));
app.use(contextMiddleware);

setupApiDocs(app, apiSpec);
app.use('/settings', createSlackSettingsRouter({ getSlackSettings, updateSlackSettings, logger }));
app.use('/settings/ring-access', createRingOwnershipRouter(ownership, logger, async email => {
  await ringAccounts.deactivate(email);
  await deleteAccountRefreshToken(email);
}));

// Healthcheck endpoint
app.get('/health', (req, res) => {
  logger.info(`${req.method} - ${req.url}`);
  res.send('Healthy');
});

// Healthcheck via slack
app.post('/health', (req, res) => {
  logger.info(`${req.method} - ${req.url}`);
  res.send('Healthy');
});

// POST endpoint to force notification for slack
app.post('/capture', (req, res) => {
  const cameraName = req.query.cameraName ?? req.body.cameraName ?? req.body.text;
  if (typeof cameraName !== 'string' || !cameraName.trim()) {
    return res.status(400).send('Select a camera before starting a capture.');
  }
  if (!ringAccounts.get(req.ringOwner)) {
    return res.status(503).send('Ring is not connected. Sign in through A-Eye or the Ring authentication API.');
  }

  const recipients = [req.ringOwner, ...req.ringMembership.participants.filter(email => email !== req.ringOwner)];
  void capture(cameraName.trim(), req.ringOwner, recipients).catch((error) => {
    logger.error(`Background capture failed for ${cameraName}:`, error);
  });
  return res.status(202).send('Capture started. Recording and Slack delivery are continuing in the background.');
});

// GET endpoint to expose camera names
app.get('/cameras', async (req, res) => {
  try {
    const ringApi = ringAccounts.get(req.ringOwner);
    if (!ringApi) {
      return res.status(503).json({ error: 'Ring is not authenticated. Sign in to Ring first.' });
    }
    const locations = await ringApi.getLocations();
    const cameras = [];
    for (const location of locations) {
      if (location.cameras && Array.isArray(location.cameras)) {
        cameras.push(...location.cameras.map(cam => cam.name));
      }
    }
    res.json(cameras);
  } catch (error) {
    logger.error('Error fetching cameras:', error);
    res.status(500).json({ error: 'Could not load Ring cameras.' });
  }
});

app.use('/cameras/live', createLiveViewRouter(req => ringAccounts.get(req.ringOwner), logger));

app.get('/events', async (req, res) => {
  let start;
  let end;
  if (req.query.start !== undefined || req.query.end !== undefined) {
    if (typeof req.query.start !== 'string' || typeof req.query.end !== 'string') {
      return res.status(400).json({ error: 'Start and end timestamps are required together.' });
    }

    start = new Date(req.query.start);
    end = new Date(req.query.end);
    const duration = end.getTime() - start.getTime();
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start.toISOString() !== req.query.start ||
      end.toISOString() !== req.query.end ||
      duration < 23 * 60 * 60 * 1000 ||
      duration > 25 * 60 * 60 * 1000
    ) {
      return res.status(400).json({ error: 'Start and end must define a valid local calendar day.' });
    }
  } else {
    const requestedDay = req.query.day;
    const day = requestedDay ?? new Date().toISOString().slice(0, 10);
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: 'Day must be a date in YYYY-MM-DD format.' });
    }

    start = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== day) {
      return res.status(400).json({ error: 'Day must be a valid calendar date.' });
    }
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }

  try {
    const events = await getVideoEventsForDay(start, end, ringAccounts.getRingAccountId(req.ringOwner));
    res.json(events);
  } catch (error) {
    logger.error('Error fetching video events:', error);
    res.status(500).json({ error: 'Could not load video events.' });
  }
});

app.get('/events/:id/video', async (req, res) => {
  let stream;
  let clientDisconnected = false;
  res.on('close', () => {
    if (res.writableFinished) return;
    clientDisconnected = true;
    if (stream && !stream.destroyed) stream.destroy();
  });

  try {
    const megaLink = await getVideoEventMegaLink(req.params.id, ringAccounts.getRingAccountId(req.ringOwner));
    if (clientDisconnected || res.destroyed) return;
    if (!megaLink) {
      return res.status(404).send('Video event not found.');
    }

    const url = new URL(megaLink);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      !['mega.nz', 'mega.co.nz'].includes(url.hostname) ||
      !/^\/file\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
      !/^[A-Za-z0-9_-]+$/.test(url.hash.slice(1))
    ) {
      return res.status(502).send('The saved MEGA link is not a supported video link.');
    }

    const video = await openMegaFileStream(megaLink, req.headers.range);
    stream = video.stream;
    stream.on('error', (error) => {
      if (clientDisconnected || res.destroyed) return;

      logger.error('Failed to stream video from MEGA:', error);
      if (res.headersSent) {
        res.destroy();
      } else {
        res.status(502).end('Could not stream video from MEGA.');
      }
    });
    if (clientDisconnected || res.destroyed) {
      if (!stream.destroyed) stream.destroy();
      return;
    }

    res.status(video.statusCode).set(video.headers);
    stream.pipe(res);
  } catch (error) {
    if (clientDisconnected || res.destroyed) return;
    if (error.statusCode === 416) {
      return res.status(416).set('Content-Range', error.contentRange).end();
    }
    logger.error('Error opening video stream:', error);
    return res.status(502).send('Could not open video stream.');
  }
});

app.get('/events/:id/thumbnail', async (req, res) => {
  let stream;
  let clientDisconnected = false;
  res.on('close', () => {
    if (res.writableFinished) return;
    clientDisconnected = true;
    if (stream && !stream.destroyed) stream.destroy();
  });

  try {
    const thumbnailLink = await getVideoEventThumbnailLink(req.params.id, ringAccounts.getRingAccountId(req.ringOwner));
    if (clientDisconnected || res.destroyed) return;
    if (!thumbnailLink) {
      return res.status(404).end();
    }

    const url = new URL(thumbnailLink);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      !['mega.nz', 'mega.co.nz'].includes(url.hostname) ||
      !/^\/file\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
      !/^[A-Za-z0-9_-]+$/.test(url.hash.slice(1))
    ) {
      return res.status(502).end();
    }

    const thumbnail = await openMegaFileStream(thumbnailLink, undefined, 'image/jpeg');
    stream = thumbnail.stream;
    stream.on('error', (error) => {
      if (clientDisconnected || res.destroyed) return;
      logger.error('Failed to stream video thumbnail from MEGA:', error);
      if (res.headersSent) {
        res.destroy();
      } else {
        res.status(502).end();
      }
    });
    if (clientDisconnected || res.destroyed) {
      if (!stream.destroyed) stream.destroy();
      return;
    }

    res.status(thumbnail.statusCode).set(thumbnail.headers);
    stream.pipe(res);
  } catch (error) {
    if (clientDisconnected || res.destroyed) return;
    logger.error('Error opening video thumbnail:', error);
    res.status(502).end();
  }
});

app.get('/push/config', (_req, res) => {
  res.json(getPushConfiguration());
});

app.post('/push/subscriptions', async (req, res) => {
  const subscription = req.body;
  if (!isValidPushSubscription(subscription)) {
    return res.status(400).json({ error: 'A valid browser push subscription is required.' });
  }

  try {
    await storePushSubscription(subscription, req.accountEmail);
    res.status(201).json({ subscribed: true });
  } catch (error) {
    logger.error('Error storing browser push subscription:', error);
    res.status(500).json({ error: 'Could not enable push notifications.' });
  }
});

app.delete('/push/subscriptions', async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!isAllowedPushEndpoint(endpoint)) {
    return res.status(400).json({ error: 'A valid browser push endpoint is required.' });
  }

  try {
    await deletePushSubscription(endpoint, req.accountEmail);
    res.status(204).end();
  } catch (error) {
    logger.error('Error deleting browser push subscription:', error);
    res.status(500).json({ error: 'Could not disable push notifications.' });
  }
});

function isValidPushSubscription(subscription) {
  return subscription &&
    isAllowedPushEndpoint(subscription.endpoint) &&
    typeof subscription.keys?.p256dh === 'string' &&
    typeof subscription.keys?.auth === 'string' &&
    subscription.keys.p256dh.length > 0 &&
    subscription.keys.auth.length > 0;
}

function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'fcm.googleapis.com' ||
      host === 'push.services.mozilla.com' ||
      host.endsWith('.push.services.mozilla.com') ||
      host === 'web.push.apple.com' ||
      host.endsWith('.notify.windows.com');
  } catch {
    return false;
  }
}

setupAuth(app, logger, (refreshToken, email) => ringAccounts.activate(email, refreshToken),
  email => Boolean(ringAccounts.get(email)));

await ringAccounts.restore(await listRingAccounts());
app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
});
