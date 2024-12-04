import 'dotenv/config';
import { RingApi } from 'ring-client-api';
import { handleRingNotification } from './index.mjs';

const { env } = process;

describe('handleRingNotification', () => {
    it('should be able to record, snapshot, upload and slack notify', async () => {
      // Arrange
      const ringApi = new RingApi({
        refreshToken: env.RING_REFRESH_TOKEN,
      });
      const locations = await ringApi.getLocations();
      const camera = locations[0].cameras[0];
      const notif = { android_config: { body: `There is a motion at your ${camera.name}`} };
  
      // Act
      await handleRingNotification(camera, notif);

      // Assert
      console.log("Integration test complete");
    }, 30000);
  });
  