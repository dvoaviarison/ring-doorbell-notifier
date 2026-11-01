jest.mock('../helpers/dateHelper/index.mjs', () => ({
    getFormattedDateTime: () => '2026-11-01_120000'
}));

jest.mock('../helpers/notificationHelper/index.mjs', () => ({
    sendSlackNotificationWithVideo: jest.fn()
}));

jest.mock('../helpers/uploadHelper/index.mjs', () => ({
    uploadFileToMega: jest.fn()
}));

jest.mock('../helpers/messageHelper/index.mjs', () => ({
    formatMessage: jest.fn((body) => `@channel: ${body}`)
}));

import { handleRingNotification } from './index.mjs';
import { sendSlackNotificationWithVideo } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs';
import { formatMessage } from '../helpers/messageHelper/index.mjs';

describe('handleRingNotification', () => {
    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
        jest.clearAllMocks();
    });

    it('prepares the message while recording, then uploads the video to Mega and Slack concurrently', async () => {
        let resolveRecording;
        let resolveMega;
        let resolveSlack;
        const recording = new Promise((resolve) => {
            resolveRecording = resolve;
        });
        uploadFileToMega.mockReturnValue(new Promise((resolve) => {
            resolveMega = resolve;
        }));
        sendSlackNotificationWithVideo.mockReturnValue(new Promise((resolve) => {
            resolveSlack = resolve;
        }));

        const camera = {
            name: 'Front door',
            id: 'camera-id',
            recordToFile: jest.fn().mockReturnValue(recording)
        };
        const notification = {
            android_config: { body: 'Motion detected' }
        };

        const notificationPromise = handleRingNotification(camera, notification);
        const videoFileName = 'Front door-2026-11-01_120000.mp4';

        expect(formatMessage).toHaveBeenCalledWith('Motion detected');
        expect(camera.recordToFile).toHaveBeenCalledWith(
            `/recordings/${videoFileName}`,
            10
        );
        expect(uploadFileToMega).not.toHaveBeenCalled();
        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();

        resolveRecording();
        await new Promise(setImmediate);

        expect(uploadFileToMega).toHaveBeenCalledWith(videoFileName);
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: Motion detected',
            videoFileName
        );

        resolveMega('https://mega.example/video');
        resolveSlack({});
        await expect(notificationPromise).resolves.toBe('@channel: Motion detected');
    });
});
