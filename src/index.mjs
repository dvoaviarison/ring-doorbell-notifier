import dotenv from 'dotenv';
import { run } from './app.mjs';
import { logger } from './helpers/logHelper/index.mjs';
import { updateEnvValue, purgeLocalFiles } from './helpers/fileHelper/index.mjs';
import { getLoggedInRingApi, findCamera } from './helpers/ringHelper/index.mjs';
import { handleRingNotification } from './ringNotificationHandler/index.mjs';
import { contextMiddleware } from './helpers/contextHelper/index.mjs';
import { setupAuth, setupSession, authMiddleware } from './helpers/authHelper/index.mjs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env' });
const { env } = process;
const app = express();
app.set('trust proxy', 1);
const port = env.APP_SERVER_PORT;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
app.post('/update-snapshot-time', (req, res) => {
  const snapshotTime = req.body.snapshotTime ?? req.body.text;
  updateEnvFile({ key: 'APP_SNAPSHOT_TIME_SEC', value: snapshotTime }, res);
});

// POST endpoint to update slack channel ID
app.post('/update-user-prompt', (req, res) => {
  const userPrompt = req.body.userPrompt ?? req.body.text;
  updateEnvFile({ key: 'APP_AI_USER_PROMPT', value: userPrompt }, res);
});

// POST endpoint to update AI type: ollama|gemini|together-ai
app.post('/update-ai-type', (req, res) => {
  const aiType = req.body.aiType ?? req.body.text;
  updateEnvFile({ key: 'APP_AI_TYPE', value: aiType }, res);
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
