import 'dotenv/config';
import { RingApi } from 'ring-client-api';
import { takeSnapshotFromVideo, recordVideoFromCamera } from './index.mjs';
import { purgeLocalFiles, checkFileExists } from '../fileHelper/index.mjs';

const { env } = process;

describe('takeSnapshotFromVideo', () => {
  it('should be able to take snapshot from video', async () => {
    // Arrange
    const videoFileName = 'recording.test.mp4';
    const snapshotFileName = 'snapshot.test.png';

    // Act
    var gotSnapshot = await takeSnapshotFromVideo(videoFileName, snapshotFileName);

    // Assert
    expect(gotSnapshot).toBe(true);
  }, 10000);
});

describe('recordVideoFromCamera', () => {
  it('should be able to record a video from camera', async () => {
    // Arrange
    const videoFileName = '.temp/recording.test.mp4';
    const ringApi = new RingApi({
      refreshToken: env.RING_REFRESH_TOKEN,
    });
    const locations = await ringApi.getLocations();
    const camera = locations[0].cameras[0];

    // Act
    await recordVideoFromCamera(camera, videoFileName, 10);

    // Assert
    const recordingSuccessful = await checkFileExists(`${env.APP_RECORDING_FOLDER}/${videoFileName}`);
    expect(recordingSuccessful).toBe(true);
    // purgeLocalFiles(`${env}/.temps`);
  }, 60000);
});