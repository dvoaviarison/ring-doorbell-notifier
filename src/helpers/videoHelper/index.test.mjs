import 'dotenv/config';
import { recordVideoFromCamera } from './index.mjs';
import { getLoggedInRingApi } from '../ringHelper/index.mjs';
import { checkFileExists } from '../fileHelper/index.mjs';

const { env } = process;

describe('recordVideoFromCamera', () => {
  it('should be able to record a video from camera', async () => {
    // Arrange
    const videoFileName = '.temp/recording.test.mp4';
    const ringApi = await getLoggedInRingApi();
    const locations = await ringApi.getLocations();
    const camera = locations[0].cameras[0];

    // Act
    await recordVideoFromCamera(camera, videoFileName, 10);

    // Assert
    const recordingSuccessful = await checkFileExists(`${env.APP_RECORDING_FOLDER}/${videoFileName}`);
    expect(recordingSuccessful).toBe(true);
  }, 60000);
});