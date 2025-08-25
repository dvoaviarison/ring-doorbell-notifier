import winston from 'winston';
import { asyncLocalStorage } from '../contextHelper/index.mjs';

const transports = [
  new winston.transports.Console(),
];

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      // Get the user from the async local storage if it exists.
      const store = asyncLocalStorage.getStore();
      const user = store?.user || 'system';

      return `${timestamp} [${user}] [${level}]: ${message}`;
    })
  ),
  transports,
});
