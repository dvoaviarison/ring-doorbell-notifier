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

// Start the main function
logger.info('Starting the service');
const ringApi = getLoggedInRingApi();
await run(ringApi);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Healthcheck endpoint
app.get('/health', (req, res) => {
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
  const { value } = req.body;
  updateEnvFile({ key: 'APP_AI_USER_PROMPT', value }, res);
});

// POST endpoint to force notification
app.post('/capture', async (req, res) => {
  try {
    logger.info('Capture on demand request received');
    const { cameraName } = req.body;
    const locations = await ringApi.getLocations();
    const camera = findCamera(locations, cameraName);
    const notif = { android_config: { body: `There is a motion at your ${camera.name}` } };
    const notification = await handleRingNotification(camera, notif);
    purgeLocalFiles();

    res.status(200).send(`Capture on demand complete: ${notification}`);
  } catch (error) {
    res.status(500).send(error.stack);
  }
});

app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
});
