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

jest.mock('../helpers/aiHelper/index.mjs', () => ({
    getAIPoweredVideoDescription: jest.fn()
}));

jest.mock('../helpers/pendingUploadHelper/index.mjs', () => ({
    trackPendingUpload: jest.fn(() => jest.fn())
}));

jest.mock('../helpers/fileHelper/index.mjs', () => ({
    purgeLocalFiles: jest.fn()
}));

import { handleRingNotification } from './index.mjs';
import { sendSlackNotificationWithVideo } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs';
import { formatMessage } from '../helpers/messageHelper/index.mjs';
import { getAIPoweredVideoDescription } from '../helpers/aiHelper/index.mjs';
import { trackPendingUpload } from '../helpers/pendingUploadHelper/index.mjs';
import { purgeLocalFiles } from '../helpers/fileHelper/index.mjs';

describe('handleRingNotification', () => {
    const previousAiEnabled = process.env.APP_ENABLE_AI;

    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
        process.env.APP_ENABLE_AI = 'false';
        jest.clearAllMocks();
    });

    afterAll(() => {
        if (previousAiEnabled === undefined) {
            delete process.env.APP_ENABLE_AI;
        } else {
            process.env.APP_ENABLE_AI = previousAiEnabled;
        }
    });

    it('sends the Slack video without waiting for the independent Mega upload', async () => {
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

        expect(camera.recordToFile).toHaveBeenCalledWith(
            `/recordings/${videoFileName}`,
            10
        );
        expect(uploadFileToMega).not.toHaveBeenCalled();
        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();

        resolveRecording();
        await new Promise(setImmediate);

        expect(formatMessage).toHaveBeenCalledWith('Motion detected');
        expect(uploadFileToMega).toHaveBeenCalledWith(videoFileName);
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: Motion detected',
            videoFileName
        );
        expect(trackPendingUpload).toHaveBeenCalledWith(`/recordings/${videoFileName}`);
        expect(trackPendingUpload.mock.results[0].value).not.toHaveBeenCalled();
        expect(purgeLocalFiles).not.toHaveBeenCalled();

        resolveSlack({});
        await expect(notificationPromise).resolves.toBe('@channel: Motion detected');
        expect(trackPendingUpload.mock.results[0].value).toHaveBeenCalledTimes(1);
        expect(purgeLocalFiles).toHaveBeenCalled();
        resolveMega('https://mega.example/video');
    });

    it('uses the AI description as the Slack video message when AI is enabled', async () => {
        process.env.APP_ENABLE_AI = 'true';
        let resolveDescription;
        getAIPoweredVideoDescription.mockReturnValue(new Promise((resolve) => {
            resolveDescription = resolve;
        }));
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        sendSlackNotificationWithVideo.mockResolvedValue({});

        const camera = {
            name: 'Front door',
            recordToFile: jest.fn().mockResolvedValue(undefined)
        };
        const notification = {
            android_config: { body: 'Motion detected' }
        };

        const notificationPromise = handleRingNotification(camera, notification);
        await new Promise(setImmediate);

        expect(uploadFileToMega).toHaveBeenCalledWith('Front door-2026-11-01_120000.mp4');
        expect(getAIPoweredVideoDescription).toHaveBeenCalledWith(
            'Front door-2026-11-01_120000.mp4',
            'Front door'
        );
        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();

        resolveDescription('A person is at the front door.');
        await notificationPromise;

        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: A person is at the front door.',
            'Front door-2026-11-01_120000.mp4'
        );
    });

    it('sends the Slack video even when the Mega upload fails', async () => {
        uploadFileToMega.mockRejectedValue(new Error('Mega unavailable'));
        sendSlackNotificationWithVideo.mockResolvedValue({});

        const camera = {
            name: 'Front door',
            recordToFile: jest.fn().mockResolvedValue(undefined)
        };
        const notification = {
            android_config: { body: 'Motion detected' }
        };

        await expect(handleRingNotification(camera, notification))
            .resolves.toBe('@channel: Motion detected');
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: Motion detected',
            'Front door-2026-11-01_120000.mp4'
        );
    });

    it('keeps the recording protected from cleanup until Slack succeeds', async () => {
        let rejectSlack;
        const releaseFile = jest.fn();
        trackPendingUpload.mockReturnValue(releaseFile);
        uploadFileToMega.mockReturnValue(new Promise(() => {}));
        sendSlackNotificationWithVideo.mockReturnValue(new Promise((_, reject) => {
            rejectSlack = reject;
        }));

        const camera = {
            name: 'Front door',
            recordToFile: jest.fn().mockResolvedValue(undefined)
        };
        const notificationPromise = handleRingNotification(camera, {
            android_config: { body: 'Motion detected' }
        });
        await new Promise(setImmediate);

        expect(releaseFile).not.toHaveBeenCalled();
        expect(purgeLocalFiles).not.toHaveBeenCalled();

        rejectSlack(new Error('Slack unavailable'));
        await expect(notificationPromise).rejects.toThrow('Slack unavailable');
        expect(releaseFile).not.toHaveBeenCalled();
        expect(purgeLocalFiles).not.toHaveBeenCalled();
    });
});
