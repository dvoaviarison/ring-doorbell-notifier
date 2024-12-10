import 'dotenv/config';
import { handleRingNotification } from './index.mjs';
import { logger } from '../helpers/logHelper/index.mjs';
import { getLoggedInRingApi } from '../helpers/ringHelper/index.mjs';

const { env } = process;

describe('handleRingNotification', () => {
    it('should be able to record, snapshot, upload and slack notify', async () => {
      // Arrange
      const ringApi = getLoggedInRingApi();;
      const locations = await ringApi.getLocations();
      const camera = locations[0].cameras[0];
      const notif = { android_config: { body: `There is a motion at your ${camera.name}`} };
  
      // Act
      await handleRingNotification(camera, notif);

      // Assert
      logger.info("Integration test complete");
    }, 30000);
  });
  