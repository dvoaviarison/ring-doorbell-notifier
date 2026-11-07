import dotenv from 'dotenv';
import { run } from './app.mjs';
import { logger } from './helpers/logHelper/index.mjs';
import { updateEnvValue, purgeLocalFiles } from './helpers/fileHelper/index.mjs';
import { getLoggedInRingApi, findCamera } from './helpers/ringHelper/index.mjs';
import { handleRingNotification } from './ringNotificationHandler/index.mjs';
import { contextMiddleware } from './helpers/contextHelper/index.mjs';
import { setupAuth, setupSession, authMiddleware } from './helpers/authHelper/index.mjs';
import {
  deletePushSubscription,
  getVideoEventMegaLink,
  getVideoEventThumbnailLink,
  getVideoEventsForDay,
  storePushSubscription
} from './helpers/dbHelper/index.mjs';
import { getPushConfiguration } from './helpers/pushNotificationHelper/index.mjs';
import { openMegaFileStream } from './helpers/videoStreamHelper/index.mjs';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
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
let ringApi;
let ringApiCleanup;
let ringApiActivation = 0;

function updateEnvFile(req, res) {
  const { key, value } = req;
  if (!value) {
    return res.status(400).send('Value is required');
  }

  try {
    updateEnvValue(key, value);
    res.status(200).send(`Updated ${key} to ${value}`);
  } catch (error) {
    logger.error('Error updating .env file:', error);
    res.status(500).send('An error occurred while updating the .env file');
  }
}

async function capture(cameraName) {
  if (!ringApi) {
    throw new Error('Ring is not authenticated yet. Sign in to Ring first.');
  }
  logger.info(`Capture on demand request received for ${cameraName}`);
  const locations = await ringApi.getLocations();
  const camera = findCamera(locations, cameraName);
  const notif = { android_config: { body: `There is a motion at your ${camera.name}` } };
  const notification = await handleRingNotification(camera, notif);
  purgeLocalFiles();
  return notification;
}

async function activateRingApi(refreshToken) {
  const activation = ++ringApiActivation;
  const api = await getLoggedInRingApi(refreshToken);
  let cleanup;
  try {
    cleanup = await run(api);
  } catch (error) {
    api.disconnect();
    throw error;
  }

  if (activation !== ringApiActivation) {
    cleanup();
    api.disconnect();
    return;
  }

  const previousApi = ringApi;
  const previousCleanup = ringApiCleanup;
  ringApi = api;
  ringApiCleanup = cleanup;
  previousCleanup?.();
  previousApi?.disconnect();
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure session and Ring authentication
setupSession(app);
app.use((req, res, next) => authMiddleware(req, res, next, () => Boolean(ringApi)));
app.use(contextMiddleware);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiSpec));

// Serve static files (after protection)
app.use(express.static(path.join(__dirname, 'public')));

// Home page :)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

// POST endpoint to update slack channel ID
app.post('/update-slack-channel', (req, res) => {
  const { channelId } = req.body;
  updateEnvFile({ key: 'SLACK_CHANNEL_ID', value: channelId }, res);
});

// POST endpoint to update slack channel ID
app.post('/update-user-prompt', (req, res) => {
  const userPrompt = req.body.userPrompt ?? req.body.text;
  updateEnvFile({ key: 'APP_AI_USER_PROMPT', value: userPrompt }, res);
});

// POST endpoint to force notification for slack
app.post('/capture', (req, res) => {
  const cameraName = req.query.cameraName ?? req.body.cameraName ?? req.body.text;
  if (typeof cameraName !== 'string' || !cameraName.trim()) {
    return res.status(400).send('Select a camera before starting a capture.');
  }
  if (!ringApi) {
    return res.status(503).send('Ring is not connected. Connect your account in Settings first.');
  }

  void capture(cameraName.trim()).catch((error) => {
    logger.error(`Background capture failed for ${cameraName}:`, error);
  });
  return res.status(202).send('Capture started. Recording and Slack delivery are continuing in the background.');
});

// GET endpoint to expose camera names
app.get('/cameras', async (req, res) => {
  try {
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
    const events = await getVideoEventsForDay(start, end);
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
    const megaLink = await getVideoEventMegaLink(req.params.id);
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
    const thumbnailLink = await getVideoEventThumbnailLink(req.params.id);
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
    await storePushSubscription(subscription);
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
    await deletePushSubscription(endpoint);
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

// GET /env?name=ENV_VAR_NAME
app.get('/env', (req, res) => {
  const { name } = req.query;
  if (name !== 'APP_AI_USER_PROMPT') {
    return res.status(400).json({ error: 'Unsupported environment setting.' });
  }
  const value = process.env[name];
  res.json({ [name]: value ?? null });
});

setupAuth(app, logger, async (refreshToken) => {
  await activateRingApi(refreshToken);
}, () => Boolean(ringApi));

app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
  logger.info('Starting the Ring notifier');
  activateRingApi().catch((error) => {
    logger.warn('Ring is not authenticated yet. Sign in through the web UI to connect:', error.message);
  });
});
