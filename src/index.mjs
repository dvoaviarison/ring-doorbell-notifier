import dotenv from 'dotenv';
import { run } from './app.mjs';
import { logger } from './helpers/logHelper/index.mjs';
import { updateEnvValue } from './helpers/fileHelper/index.mjs';
import { getLoggedInRingApi, findCamera } from './helpers/ringHelper/index.mjs';
import { handleRingNotification } from './ringNotificationHandler/index.mjs';
import { purgeLocalFiles } from './helpers/fileHelper/index.mjs';

import express from 'express';

dotenv.config({ path: '.env' });
const { env } = process;
const app = express();
const port = env.APP_SERVER_PORT;

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
  logger.info(`Capture on demand request received for ${cameraName}`);
  const locations = await ringApi.getLocations();
  const camera = findCamera(locations, cameraName);
  const notif = { android_config: { body: `There is a motion at your ${camera.name}` } };
  const notification = await handleRingNotification(camera, notif);
  purgeLocalFiles();
  return notification;
}

// Start the main function
logger.info('Starting the service');
const ringApi = await getLoggedInRingApi();
await run(ringApi);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Home page :)
app.get('/', (req, res) => {
  res.send(`Welcome to 🅁🄸🄽🄶 🄽🄾🅃🄸🄵🄸🄴🅁`);
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
app.post('/capture', async (req, res) => {
  try {
    const cameraName = req.query.cameraName ?? req.body.cameraName ?? req.body.text;
    // if (req.body.channel_id) {
    //   await sendSimpleSlackNotification(`Capture on demand request received for ${cameraName}`, req.body.channel_id);
    // }
    
    capture(cameraName);
    res.status(200).send('Capture on demand complete. Notification will be sent soon!')
  } catch (error) {
    res.status(500).send(error.stack);
  }
});

app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
});
