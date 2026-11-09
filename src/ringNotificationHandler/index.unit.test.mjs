import { createHash } from 'node:crypto';

jest.mock('node:crypto', () => ({
    ...jest.requireActual('node:crypto'),
    randomUUID: () => 'test-uuid'
}));

jest.mock('../helpers/dateHelper/index.mjs', () => ({
    getFormattedDateTime: () => '2026-11-01_120000'
}));

jest.mock('../helpers/notificationHelper/index.mjs', () => ({
    sendSlackNotificationWithVideo: jest.fn()
}));

jest.mock('../helpers/videoHelper/index.mjs', () => ({
    recordVideoFromCamera: jest.fn()
}));

jest.mock('../helpers/uploadHelper/index.mjs', () => ({
    uploadFileToMega: jest.fn()
}));

jest.mock('../helpers/messageHelper/index.mjs', () => ({
    ...jest.requireActual('../helpers/messageHelper/index.mjs'),
    formatMessage: jest.fn((body) => `@channel: ${body}`)
}));

jest.mock('../helpers/aiHelper/index.mjs', () => ({
    getAIPoweredVideoDescription: jest.fn()
}));

jest.mock('../helpers/pendingUploadHelper/index.mjs', () => ({
    trackPendingUpload: jest.fn(() => jest.fn())
}));

jest.mock('../helpers/dbHelper/index.mjs', () => ({
    storeVideoEvent: jest.fn(),
    getSlackSettings: jest.fn()
}));

jest.mock('../helpers/pushNotificationHelper/index.mjs', () => ({
    notifyPushSubscribers: jest.fn()
}));

jest.mock('../helpers/fileHelper/index.mjs', () => ({
    purgeLocalFiles: jest.fn()
}));

import { handleRingNotification as handleAccountNotification } from './index.mjs';
import { sendSlackNotificationWithVideo } from '../helpers/notificationHelper/index.mjs';
import { recordVideoFromCamera } from '../helpers/videoHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs';
import { formatMessage } from '../helpers/messageHelper/index.mjs';
import { getAIPoweredVideoDescription } from '../helpers/aiHelper/index.mjs';
import { trackPendingUpload } from '../helpers/pendingUploadHelper/index.mjs';
import { purgeLocalFiles } from '../helpers/fileHelper/index.mjs';
import { getSlackSettings, storeVideoEvent } from '../helpers/dbHelper/index.mjs';
import { notifyPushSubscribers } from '../helpers/pushNotificationHelper/index.mjs';

describe('handleRingNotification', () => {
    const accountEmail = 'person@example.com';
    const handleRingNotification = (camera, notification, email) => handleAccountNotification(camera, notification, email, '123');
    const slackSettings = { botToken: 'test-token', channelId: 'test-channel' };
    const videoFileName = `Front door-${createHash('sha256').update(accountEmail).digest('hex').slice(0, 12)}-2026-11-01_120000-test-uuid.mp4`;
    const previousAiEnabled = process.env.APP_ENABLE_AI;

    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
        process.env.APP_ENABLE_AI = 'false';
        jest.clearAllMocks();
        getSlackSettings.mockReset();
        sendSlackNotificationWithVideo.mockReset();
        trackPendingUpload.mockReset().mockImplementation(() => jest.fn());
        recordVideoFromCamera.mockReset();
        uploadFileToMega.mockReset();
        storeVideoEvent.mockReset();
        notifyPushSubscribers.mockReset();
        getSlackSettings.mockResolvedValue(slackSettings);
        storeVideoEvent.mockResolvedValue(undefined);
    });

    afterAll(() => {
        if (previousAiEnabled === undefined) {
            delete process.env.APP_ENABLE_AI;
        } else {
            process.env.APP_ENABLE_AI = previousAiEnabled;
        }
    });

    it('records and uploads once while notifying each linked account', async () => {
        const secondSettings = { botToken: 'second-token', channelId: 'second-channel' };
        getSlackSettings.mockImplementation(async email => email === accountEmail ? slackSettings : secondSettings);
        recordVideoFromCamera.mockResolvedValue(undefined);
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        sendSlackNotificationWithVideo.mockResolvedValue({});
        const camera = { name: 'Front door' };
        await handleAccountNotification(camera, {
            android_config: { body: 'Motion detected' },
            data: { event: { ding: { id: 'event-1' } } }
        }, [accountEmail, 'second@example.com', accountEmail], '123');
        await new Promise(setImmediate);
        expect(recordVideoFromCamera).toHaveBeenCalledTimes(1);
        expect(uploadFileToMega).toHaveBeenCalledTimes(1);
        expect(storeVideoEvent).toHaveBeenCalledTimes(1);
        expect(storeVideoEvent).toHaveBeenCalledWith(
            'Motion detected', 'https://mega.example/video', expect.any(Date),
            videoFileName, 'Front door', null, '123', 'event-1'
        );
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledTimes(1);
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith('@channel: Motion detected', videoFileName, slackSettings);
        expect(notifyPushSubscribers).toHaveBeenCalledTimes(2);
        expect(notifyPushSubscribers).toHaveBeenCalledWith(expect.objectContaining({ megaLink: 'https://mega.example/video' }), accountEmail);
        expect(notifyPushSubscribers).toHaveBeenCalledWith(expect.objectContaining({ megaLink: 'https://mega.example/video' }), 'second@example.com');
    });

    it('keeps the recording when the owner Slack delivery fails', async () => {
        const releaseFile = jest.fn();
        trackPendingUpload.mockReturnValue(releaseFile);
        getSlackSettings.mockResolvedValue(slackSettings);
        recordVideoFromCamera.mockResolvedValue(undefined);
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        sendSlackNotificationWithVideo.mockRejectedValueOnce(new Error('Slack unavailable')).mockResolvedValueOnce({});
        await expect(handleAccountNotification({ name: 'Front door' }, {
            android_config: { body: 'Motion detected' }
        }, [accountEmail, 'second@example.com'], '123')).rejects.toThrow('Slack unavailable');
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledTimes(1);
        expect(releaseFile).not.toHaveBeenCalled();
    });

    it('continues recording and notifying members if the owner Slack settings lookup fails', async () => {
        getSlackSettings.mockRejectedValueOnce(new Error('settings unavailable')).mockResolvedValueOnce(slackSettings);
        recordVideoFromCamera.mockResolvedValue(undefined);
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        sendSlackNotificationWithVideo.mockResolvedValue({});
        await handleAccountNotification({ name: 'Front door' }, {
            android_config: { body: 'Motion detected' }
        }, [accountEmail, 'second@example.com'], '123');
        await new Promise(setImmediate);
        expect(recordVideoFromCamera).toHaveBeenCalledTimes(1);
        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();
        expect(notifyPushSubscribers).toHaveBeenCalledTimes(2);
    });

    it('sends the Slack video without waiting for the independent Mega upload', async () => {
        let resolveRecording;
        let resolveMega;
        let resolveSlack;
        const recording = new Promise((resolve) => {
            resolveRecording = resolve;
        });
        recordVideoFromCamera.mockReturnValue(recording);
        uploadFileToMega.mockImplementation((fileName) => fileName.endsWith('.jpg')
            ? Promise.resolve('https://mega.example/thumbnail')
            : new Promise((resolve) => {
                resolveMega = resolve;
            }));
        sendSlackNotificationWithVideo.mockReturnValue(new Promise((resolve) => {
            resolveSlack = resolve;
        }));

        const camera = {
            name: 'Front door',
            id: 'camera-id'
        };
        const notification = {
            android_config: { body: 'Motion detected' }
        };

        const notificationPromise = handleRingNotification(camera, notification, accountEmail);

        await new Promise(setImmediate);
        expect(recordVideoFromCamera).toHaveBeenCalledWith(camera, videoFileName, 10);
        expect(trackPendingUpload).toHaveBeenCalledWith(`/recordings/${videoFileName}`);
        expect(trackPendingUpload.mock.results[0].value).not.toHaveBeenCalled();
        expect(uploadFileToMega).not.toHaveBeenCalled();
        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();

        resolveRecording();
        await new Promise(setImmediate);

        expect(formatMessage).toHaveBeenCalledWith('Motion detected');
        expect(uploadFileToMega).toHaveBeenCalledWith(videoFileName);
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: Motion detected',
            videoFileName,
            slackSettings
        );
        expect(trackPendingUpload).toHaveBeenCalledWith(`/recordings/${videoFileName}`);
        expect(trackPendingUpload.mock.results[0].value).not.toHaveBeenCalled();
        expect(purgeLocalFiles).not.toHaveBeenCalled();

        resolveSlack({});
        await expect(notificationPromise).resolves.toBe('@channel: Motion detected');
        expect(trackPendingUpload.mock.results[0].value).toHaveBeenCalledTimes(1);
        expect(purgeLocalFiles).toHaveBeenCalled();
        resolveMega('https://mega.example/video');
        await new Promise(setImmediate);
        expect(storeVideoEvent).toHaveBeenCalledWith(
            'Motion detected',
            'https://mega.example/video',
            expect.any(Date),
            videoFileName,
            'Front door',
            null,
            '123', undefined
        );
    });

    it('releases the recording protection if recording fails', async () => {
        recordVideoFromCamera.mockRejectedValueOnce(new Error('camera offline'));
        await expect(handleRingNotification(
            { name: 'Front door' },
            { android_config: { body: 'Motion detected' } },
            accountEmail
        )).rejects.toThrow('camera offline');
        expect(trackPendingUpload).toHaveBeenCalledWith(`/recordings/${videoFileName}`);
        expect(trackPendingUpload.mock.results[0].value).toHaveBeenCalledTimes(1);
        expect(uploadFileToMega).not.toHaveBeenCalled();
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
            id: 'camera-id'
        };
        recordVideoFromCamera.mockResolvedValue(undefined);
        const notification = {
            android_config: { body: 'Motion detected' }
        };

        const notificationPromise = handleRingNotification(camera, notification, accountEmail);
        await new Promise(setImmediate);

        expect(uploadFileToMega).toHaveBeenCalledWith(videoFileName);
        expect(getAIPoweredVideoDescription).toHaveBeenCalledWith(
            videoFileName,
            'Front door'
        );
        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();

        resolveDescription({ description: 'A person is at the front door.', category: 'person' });
        await notificationPromise;

        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: A person is at the front door.',
            videoFileName,
            slackSettings
        );
        await new Promise(setImmediate);
        expect(storeVideoEvent).toHaveBeenCalledWith(
            'A person is at the front door.',
            'https://mega.example/video',
            expect.any(Date),
            videoFileName,
            'Front door',
            'person',
            '123', undefined
        );
        expect(notifyPushSubscribers).toHaveBeenCalledWith({
            description: 'A person is at the front door.',
            megaLink: 'https://mega.example/video',
            timestamp: expect.any(Date)
        }, accountEmail);
    });

    it('saves a null category and uses the Ring text when AI fails', async () => {
        process.env.APP_ENABLE_AI = 'true';
        recordVideoFromCamera.mockResolvedValue(undefined);
        getAIPoweredVideoDescription.mockRejectedValue(new Error('Invalid AI response'));
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        sendSlackNotificationWithVideo.mockResolvedValue({});

        await expect(handleRingNotification({ name: 'Front door' }, {
            android_config: { body: 'Motion detected' }
        }, accountEmail)).resolves.toBe('@channel: Motion detected');
        await new Promise(setImmediate);
        expect(storeVideoEvent).toHaveBeenCalledWith(
            'Motion detected', 'https://mega.example/video', expect.any(Date),
            videoFileName, 'Front door', null, '123', undefined
        );
    });

    it.each(['true', 'false'])('removes a matching camera prefix before saving and sending (AI=%s)', async (aiEnabled) => {
        process.env.APP_ENABLE_AI = aiEnabled;
        recordVideoFromCamera.mockResolvedValue(undefined);
        getAIPoweredVideoDescription.mockResolvedValue({ description: 'Front door: Motion detected', category: 'delivery' });
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        sendSlackNotificationWithVideo.mockResolvedValue({});

        await handleRingNotification({ name: 'Front door' }, {
            android_config: { body: 'Front door: Motion detected' }
        }, accountEmail);

        await new Promise(setImmediate);

        expect(storeVideoEvent).toHaveBeenCalledWith(
            'Motion detected',
            'https://mega.example/video',
            expect.any(Date),
            videoFileName,
            'Front door',
            aiEnabled === 'true' ? 'delivery' : null,
            '123', undefined
        );
        expect(formatMessage).toHaveBeenCalledWith('Motion detected');
        expect(notifyPushSubscribers).toHaveBeenCalledWith(expect.objectContaining({
            description: 'Motion detected'
        }), accountEmail);
    });

    it.each([
        ['true', '@channel: Front door: Motion detected'],
        ['false', 'Front door: @channel: Motion detected'],
        ['false', '@channel @channel: Motion detected']
    ])('only adds the Slack channel mention when sending (AI=%s)', async (aiEnabled, body) => {
        process.env.APP_ENABLE_AI = aiEnabled;
        recordVideoFromCamera.mockResolvedValue(undefined);
        getAIPoweredVideoDescription.mockResolvedValue({ description: body, category: 'uncategorized' });
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        sendSlackNotificationWithVideo.mockResolvedValue({});

        await handleRingNotification({ name: 'Front door' }, { android_config: { body } }, accountEmail);
        await new Promise(setImmediate);

        expect(storeVideoEvent).toHaveBeenCalledWith(
            'Motion detected', 'https://mega.example/video', expect.any(Date),
            videoFileName, 'Front door', aiEnabled === 'true' ? 'uncategorized' : null, '123', undefined
        );
        expect(notifyPushSubscribers).toHaveBeenCalledWith(expect.objectContaining({ description: 'Motion detected' }), accountEmail);
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: Motion detected', videoFileName, slackSettings
        );
    });

    it('sends the Slack video even when the Mega upload fails', async () => {
        uploadFileToMega.mockRejectedValue(new Error('Mega unavailable'));
        sendSlackNotificationWithVideo.mockResolvedValue({});

        const camera = {
            name: 'Front door',
            id: 'camera-id'
        };
        recordVideoFromCamera.mockResolvedValue(undefined);
        const notification = {
            android_config: { body: 'Motion detected' }
        };

        await expect(handleRingNotification(camera, notification, accountEmail))
            .resolves.toBe('@channel: Motion detected');
        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: Motion detected',
            videoFileName,
            slackSettings
        );
        await new Promise(setImmediate);
        expect(storeVideoEvent).not.toHaveBeenCalled();
    });

    it('sends the Slack video even when saving the Mega event to MongoDB fails', async () => {
        uploadFileToMega.mockResolvedValue('https://mega.example/video');
        storeVideoEvent.mockRejectedValue(new Error('MongoDB unavailable'));
        sendSlackNotificationWithVideo.mockResolvedValue({});

        const camera = {
            name: 'Front door',
            id: 'camera-id'
        };
        recordVideoFromCamera.mockResolvedValue(undefined);

        await expect(handleRingNotification(camera, {
            android_config: { body: 'Motion detected' }
        }, accountEmail)).resolves.toBe('@channel: Motion detected');

        expect(sendSlackNotificationWithVideo).toHaveBeenCalledWith(
            '@channel: Motion detected',
            videoFileName,
            slackSettings
        );
        await new Promise(setImmediate);
        expect(storeVideoEvent).toHaveBeenCalledWith(
            'Motion detected',
            'https://mega.example/video',
            expect.any(Date),
            videoFileName,
            'Front door',
            null,
            '123', undefined
        );
        expect(notifyPushSubscribers).not.toHaveBeenCalled();
    });

    it('keeps the recording protected from cleanup until Slack succeeds', async () => {
        let rejectSlack;
        const releaseFile = jest.fn();
        trackPendingUpload.mockImplementation((filePath) =>
            filePath.endsWith('.jpg') ? jest.fn() : releaseFile
        );
        uploadFileToMega.mockReturnValue(new Promise(() => {}));
        sendSlackNotificationWithVideo.mockReturnValue(new Promise((_, reject) => {
            rejectSlack = reject;
        }));

        const camera = {
            name: 'Front door',
            id: 'camera-id'
        };
        recordVideoFromCamera.mockResolvedValue(undefined);
        const notificationPromise = handleRingNotification(camera, {
            android_config: { body: 'Motion detected' }
        }, accountEmail);
        await new Promise(setImmediate);

        expect(releaseFile).not.toHaveBeenCalled();
        expect(purgeLocalFiles).not.toHaveBeenCalled();

        rejectSlack(new Error('Slack unavailable'));
        await expect(notificationPromise).rejects.toThrow('Slack unavailable');
        expect(releaseFile).not.toHaveBeenCalled();
        expect(purgeLocalFiles).not.toHaveBeenCalled();
    });

    it('keeps the recording when Slack is not configured and the Mega upload fails', async () => {
        getSlackSettings.mockResolvedValue(null);
        recordVideoFromCamera.mockResolvedValue(undefined);
        uploadFileToMega.mockRejectedValue(new Error('Mega unavailable'));

        await handleRingNotification({ name: 'Front door' }, { android_config: { body: 'Motion detected' } }, accountEmail);
        await new Promise(setImmediate);
        expect(trackPendingUpload.mock.results[0].value).not.toHaveBeenCalled();
        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();
    });

    it('records and persists events when Slack is not configured for the account', async () => {
        getSlackSettings.mockResolvedValue(null);
        recordVideoFromCamera.mockResolvedValue(undefined);
        uploadFileToMega.mockResolvedValue('https://mega.example/video');

        await expect(handleRingNotification({ name: 'Front door' }, {
            android_config: { body: 'Motion detected' }
        }, accountEmail)).resolves.toBe('@channel: Motion detected');
        await new Promise(setImmediate);

        expect(sendSlackNotificationWithVideo).not.toHaveBeenCalled();
        expect(storeVideoEvent).toHaveBeenCalledWith(
            'Motion detected',
            'https://mega.example/video',
            expect.any(Date),
            videoFileName,
            'Front door',
            null,
            '123', undefined
        );
        expect(notifyPushSubscribers).toHaveBeenCalledWith(expect.any(Object), accountEmail);
    });
});
