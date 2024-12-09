import dotenv from 'dotenv';
import { run } from './app.mjs';
import { logger } from './helpers/logHelper/index.mjs';

import express from 'express';

dotenv.config({ path: '.env' });
const { env } = process;
const app = express();
const port = env.APP_SERVER_PORT;

// Start the main function
logger.info('Starting the service');
await run();

// Healthcheck endpoint
app.get('/health', (req, res) => {
  logger.info(`${req.method} - ${req.url}`);
  res.send('Healthy');
});

app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
});
