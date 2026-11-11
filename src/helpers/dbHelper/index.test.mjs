jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        db: jest.fn(),
        collection: jest.fn(),
        findOne: jest.fn(),
        updateOne: jest.fn(),
        createIndex: jest.fn(),
        insertOne: jest.fn(),
        updateMany: jest.fn(),
        find: jest.fn(),
        deleteOne: jest.fn(),
        close: jest.fn()
    })),
    ObjectId: Object.assign(
        jest.fn().mockImplementation((value) => ({
            value,
            toString: () => value
        })),
        { isValid: jest.fn((value) => /^[a-f\d]{24}$/i.test(value)) }
    ),
    ServerApiVersion: { v1: 'v1' }
}));

jest.mock('../videoThumbnailHelper/index.mjs', () => ({
    createVideoThumbnail: jest.fn()
}));

jest.mock('../uploadHelper/index.mjs', () => ({
    uploadFileToMega: jest.fn()
}));

jest.mock('../pendingUploadHelper/index.mjs', () => ({
    trackPendingUpload: jest.fn(() => jest.fn())
}));

jest.mock('../fileHelper/index.mjs', () => ({
    purgeLocalFiles: jest.fn()
}));

import { MongoClient, ObjectId } from 'mongodb';
import { createVideoThumbnail } from '../videoThumbnailHelper/index.mjs';
import { uploadFileToMega } from '../uploadHelper/index.mjs';
import { trackPendingUpload } from '../pendingUploadHelper/index.mjs';
import { purgeLocalFiles } from '../fileHelper/index.mjs';
import {
    getVideoEventsForDay,
    getVideoEventThumbnailLink,
    getVideoEventMegaLink,
    getRefreshToken,
    storeRefreshToken,
    storeVideoEvent,
    storePushSubscription,
    getPushSubscriptions,
    deletePushSubscription,
    getPushCategories,
    setPushCategories,
    getSlackSettings,
    updateSlackSettings,
    getSlackSigningCandidates,
    listRingAccounts
} from './index.mjs';

const client = MongoClient.mock.results[0].value;
const eventCursor = {
    sort: jest.fn(),
    toArray: jest.fn()
};
const previousRecordingFolder = process.env.APP_RECORDING_FOLDER;

describe('Ring refresh token persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.APP_RECORDING_FOLDER = '/recordings';
        client.connect.mockResolvedValue(undefined);
        client.db.mockReturnValue(client);
        client.collection.mockReturnValue(client);
        client.findOne.mockResolvedValue({ value: 'stored-token' });
        client.updateOne.mockResolvedValue({
            matchedCount: 0,
            modifiedCount: 0,
            upsertedCount: 1
        });
        client.createIndex.mockResolvedValue('endpoint_unique_index');
        client.insertOne.mockResolvedValue({ insertedId: 'event-id' });
        client.updateMany.mockResolvedValue({ modifiedCount: 0 });
        client.find.mockReturnValue(eventCursor);
        eventCursor.sort.mockReturnValue(eventCursor);
        eventCursor.toArray.mockResolvedValue([]);
        createVideoThumbnail.mockResolvedValue('Front door-2026-11-06_120000.jpg');
        uploadFileToMega.mockResolvedValue('https://mega.example/thumbnail');
    });

    afterAll(() => {
        if (previousRecordingFolder === undefined) {
            delete process.env.APP_RECORDING_FOLDER;
        } else {
            process.env.APP_RECORDING_FOLDER = previousRecordingFolder;
        }
    });

    it('loads the refresh token from MongoDB', async () => {
        await expect(getRefreshToken(' Person@Example.com ')).resolves.toBe('stored-token');
        expect(client.findOne).toHaveBeenCalledWith({
            key: 'account:person@example.com:refreshToken',
            accountEmail: 'person@example.com'
        });
        expect(client.close).not.toHaveBeenCalled();
    });

    it('requires Ring sign-in when MongoDB has no refresh token', async () => {
        client.findOne.mockResolvedValue(null);

        await expect(getRefreshToken('person@example.com'))
            .rejects.toThrow('No Ring refresh token found for this account. Sign in through A-Eye or the Ring authentication API.');
        expect(client.close).not.toHaveBeenCalled();
    });

    it('propagates MongoDB errors instead of falling back to an environment token', async () => {
        const error = new Error('MongoDB unavailable');
        client.connect.mockRejectedValue(error);

        await expect(getRefreshToken('person@example.com')).rejects.toBe(error);
    });

    it('stores the refresh token in MongoDB', async () => {
        await storeRefreshToken('new-token', 'Person@Example.com');

        expect(client.updateOne).toHaveBeenCalledWith(
            { key: 'account:person@example.com:refreshToken', accountEmail: 'person@example.com' },
            { $set: { value: 'new-token', accountEmail: 'person@example.com', type: 'refreshToken' } },
            { upsert: true }
        );
        expect(client.close).not.toHaveBeenCalled();
    });

    it('stores a video event without the Slack channel prefix', async () => {
        const timestamp = new Date('2026-11-06T12:00:00.000Z');

        await storeVideoEvent(
            '@channel: Motion detected',
            'https://mega.example/video',
            timestamp,
            'Front door-2026-11-06_120000.mp4',
            'Front door',
            'delivery',
            '123'
        );

        expect(client.insertOne).toHaveBeenCalledWith({
            timestamp,
            description: 'Motion detected',
            category: 'delivery',
            megaLink: 'https://mega.example/video',
            cameraName: 'Front door',
            thumbnailLink: 'https://mega.example/thumbnail',
            ringAccountId: '123'
        });
        expect(createVideoThumbnail).toHaveBeenCalledWith('Front door-2026-11-06_120000.mp4');
        expect(uploadFileToMega).toHaveBeenCalledWith('Front door-2026-11-06_120000.jpg');
        expect(trackPendingUpload).toHaveBeenCalledWith(
            expect.stringContaining('Front door-2026-11-06_120000.mp4')
        );
        expect(trackPendingUpload).toHaveBeenCalledWith(
            expect.stringContaining('Front door-2026-11-06_120000.jpg')
        );
        expect(purgeLocalFiles).toHaveBeenCalled();
        expect(client.db).toHaveBeenCalledWith('ringnotifier');
        expect(client.collection).toHaveBeenCalledWith('events');
        expect(client.close).not.toHaveBeenCalled();
    });

    it('stores the event without a thumbnail when thumbnail generation fails', async () => {
        createVideoThumbnail.mockRejectedValue(new Error('FFmpeg unavailable'));

        await storeVideoEvent(
            'Motion detected',
            'https://mega.example/video',
            new Date('2026-11-06T12:00:00.000Z'),
            'Front door-2026-11-06_120000.mp4',
            undefined,
            null,
            '123'
        );

        expect(client.insertOne).toHaveBeenCalledWith({
            timestamp: new Date('2026-11-06T12:00:00.000Z'),
            description: 'Motion detected',
            category: null,
            megaLink: 'https://mega.example/video',
            ringAccountId: '123'
        });
        expect(uploadFileToMega).not.toHaveBeenCalled();
    });

    it('stores the event without a thumbnail when thumbnail upload fails', async () => {
        uploadFileToMega.mockRejectedValue(new Error('MEGA unavailable'));

        await storeVideoEvent(
            'Motion detected',
            'https://mega.example/video',
            new Date('2026-11-06T12:00:00.000Z'),
            'Front door-2026-11-06_120000.mp4',
            undefined,
            null,
            '123'
        );

        expect(client.insertOne).toHaveBeenCalledWith({
            timestamp: new Date('2026-11-06T12:00:00.000Z'),
            description: 'Motion detected',
            category: null,
            megaLink: 'https://mega.example/video',
            ringAccountId: '123'
        });
    });

    it('loads a selected UTC day of video events newest first', async () => {
        const events = [{
            _id: { toString: () => 'event-id' },
            description: 'Motion detected',
            category: 'person',
            cameraName: 'Front door',
            thumbnailLink: 'https://mega.example/thumbnail'
        }];
        const start = new Date('2026-11-06T00:00:00.000Z');
        const end = new Date('2026-11-07T00:00:00.000Z');
        eventCursor.toArray.mockResolvedValue(events);

        await expect(getVideoEventsForDay(start, end, '123')).resolves.toEqual([
            {
                id: 'event-id',
                description: 'Motion detected',
                category: 'person',
                cameraName: 'Front door',
                thumbnailLink: 'https://mega.example/thumbnail'
            }
        ]);

        expect(client.find).toHaveBeenCalledWith(
            { ringAccountId: '123', timestamp: { $gte: start, $lt: end } },
            { projection: { _id: 1, timestamp: 1, description: 1, category: 1, megaLink: 1, thumbnailLink: 1, cameraName: 1 } }
        );
        expect(eventCursor.sort).toHaveBeenCalledWith({ timestamp: -1 });
        expect(client.close).not.toHaveBeenCalled();
    });

    it('isolates reads by verified Ring account and rejects missing identities', async () => {
        const start = new Date('2026-11-06T00:00:00.000Z');
        const end = new Date('2026-11-07T00:00:00.000Z');
        await getVideoEventsForDay(start, end, '456');
        expect(client.find).toHaveBeenCalledWith(
            { ringAccountId: '456', timestamp: { $gte: start, $lt: end } },
            expect.any(Object)
        );
        await expect(getVideoEventsForDay(start, end, undefined)).rejects.toThrow('verified Ring account ID');
        await expect(getVideoEventMegaLink('0123456789abcdef01234567', 'person@example.com')).rejects.toThrow('verified Ring account ID');
    });

    it('deduplicates a Ring notification within its Ring account', async () => {
        await storeVideoEvent('Motion', 'https://mega.example/video', new Date(), undefined, 'Front', null, '123', 'ding-1');
        expect(client.updateOne).toHaveBeenCalledWith(
            { _id: expect.anything() },
            { $setOnInsert: expect.objectContaining({ ringAccountId: '123', description: 'Motion' }) },
            { upsert: true }
        );
        expect(client.insertOne).not.toHaveBeenCalled();
    });
    it.each([
        ['car passing by', 'vehicle'],
        ['person(s)', 'person'],
        ['animals', 'animal']
    ])('translates legacy %s categories to %s on read', async (oldCategory, category) => {
        eventCursor.toArray.mockResolvedValue([{
            _id: { toString: () => 'event-id' },
            category: oldCategory
        }]);
        await expect(getVideoEventsForDay(new Date('2026-11-06'), new Date('2026-11-07'), '123'))
            .resolves.toEqual([{ id: 'event-id', category }]);
    });

    it('loads a MEGA thumbnail link by event id', async () => {
        client.findOne.mockResolvedValue({ thumbnailLink: 'https://mega.nz/file/id#key' });

        await expect(getVideoEventThumbnailLink('0123456789abcdef01234567', '123'))
            .resolves.toBe('https://mega.nz/file/id#key');

        expect(client.findOne).toHaveBeenCalledWith(
            { _id: expect.objectContaining({ value: '0123456789abcdef01234567' }), ringAccountId: '123' },
            { projection: { _id: 0, thumbnailLink: 1 } }
        );
        expect(client.close).not.toHaveBeenCalled();
    });

    it('loads a MEGA link by event id for in-page video playback', async () => {
        client.findOne.mockResolvedValue({ megaLink: 'https://mega.nz/file/id#key' });

        await expect(getVideoEventMegaLink('0123456789abcdef01234567', '123'))
            .resolves.toBe('https://mega.nz/file/id#key');

        expect(ObjectId).toHaveBeenCalledWith('0123456789abcdef01234567');
        expect(client.findOne).toHaveBeenCalledWith(
            { _id: expect.objectContaining({ value: '0123456789abcdef01234567' }), ringAccountId: '123' },
            { projection: { _id: 0, megaLink: 1 } }
        );
        expect(client.close).not.toHaveBeenCalled();
    });

    it('keeps the shared client open while video links are loaded concurrently', async () => {
        client.findOne
            .mockResolvedValueOnce({ thumbnailLink: 'https://mega.nz/file/thumbnail#key' })
            .mockResolvedValueOnce({ megaLink: 'https://mega.nz/file/video#key' });

        await expect(Promise.all([
            getVideoEventThumbnailLink('0123456789abcdef01234567', '123'),
            getVideoEventMegaLink('0123456789abcdef01234567', '123')
        ])).resolves.toEqual([
            'https://mega.nz/file/thumbnail#key',
            'https://mega.nz/file/video#key'
        ]);
        expect(client.close).not.toHaveBeenCalled();
    });

    it('rejects invalid event ids without querying MongoDB', async () => {
        await expect(getVideoEventMegaLink('not-an-id', '123')).resolves.toBeNull();
        expect(client.findOne).not.toHaveBeenCalled();
    });

    it('atomically assigns a browser endpoint to the current account', async () => {
        const subscription = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/test',
            keys: { p256dh: 'public-key', auth: 'auth-secret' }
        };
        await storePushSubscription(subscription, 'Person@Example.com');

        expect(client.createIndex).toHaveBeenCalledWith({ endpoint: 1 }, { unique: true });
        expect(client.updateOne).toHaveBeenCalledWith(
            { endpoint: subscription.endpoint },
            expect.objectContaining({
                $set: expect.objectContaining({ endpoint: subscription.endpoint, accountEmail: 'person@example.com', subscription })
            }),
            { upsert: true }
        );
        expect(client.collection).toHaveBeenCalledWith('pushSubscriptions');
        expect(client.close).not.toHaveBeenCalled();
    });

    it('loads stored browser push subscriptions', async () => {
        const subscriptions = [{ endpoint: 'https://fcm.googleapis.com/fcm/send/test' }];
        eventCursor.toArray.mockResolvedValue(subscriptions);

        await expect(getPushSubscriptions('person@example.com')).resolves.toBe(subscriptions);
        expect(client.find).toHaveBeenCalledWith(
            { accountEmail: 'person@example.com' },
            { projection: { _id: 0, endpoint: 1, accountEmail: 1, subscription: 1 } }
        );
        expect(client.close).not.toHaveBeenCalled();
    });

    it('deletes a browser push subscription by endpoint', async () => {
        const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
        await deletePushSubscription(endpoint, 'person@example.com');

        expect(client.deleteOne).toHaveBeenCalledWith({ endpoint, accountEmail: 'person@example.com' });
        expect(client.close).not.toHaveBeenCalled();
    });

    it('defaults push notification categories to all and honors saved selections', async () => {
        client.findOne.mockResolvedValueOnce(null);
        await expect(getPushCategories('person@example.com'))
            .resolves.toEqual(['delivery', 'vehicle', 'person', 'animal', 'trash', 'uncategorized']);

        client.findOne.mockResolvedValueOnce({ value: ['person', 'delivery'] });
        await expect(getPushCategories('person@example.com')).resolves.toEqual(['delivery', 'person', 'trash']);

        client.findOne.mockResolvedValueOnce({ value: [] });
        await expect(getPushCategories('person@example.com')).resolves.toEqual(['trash']);

        client.findOne.mockResolvedValueOnce({ value: ['person', 'delivery'], trashPreferenceSet: true });
        await expect(getPushCategories('person@example.com')).resolves.toEqual(['delivery', 'person']);

        client.findOne.mockResolvedValueOnce({ value: ['trash'], trashPreferenceSet: true });
        await expect(getPushCategories('person@example.com')).resolves.toEqual(['trash']);
    });

    it('stores push notification categories and rejects invalid ones', async () => {
        await expect(setPushCategories('Person@Example.com', ['person', 'delivery']))
            .resolves.toEqual(['delivery', 'person']);
        expect(client.updateOne).toHaveBeenCalledWith(
            { key: 'account:person@example.com:pushCategories', accountEmail: 'person@example.com' },
            { $set: {
                key: 'account:person@example.com:pushCategories',
                accountEmail: 'person@example.com',
                type: 'pushCategories',
                value: ['delivery', 'person'],
                trashPreferenceSet: true
            } },
            { upsert: true }
        );
        await expect(setPushCategories('person@example.com', ['other'])).rejects.toThrow(TypeError);
    });

    it('updates Slack settings without including omitted secret fields', async () => {
        await updateSlackSettings('Person@Example.com', { channelId: 'new-channel' });

        expect(client.updateOne).toHaveBeenCalledWith(
            { key: 'account:person@example.com:slackSettings', accountEmail: 'person@example.com' },
            { $set: expect.objectContaining({
                channelId: 'new-channel',
                accountEmail: 'person@example.com',
                type: 'slackSettings'
            }) },
            { upsert: true }
        );
        const update = client.updateOne.mock.calls[0][1].$set;
        expect(update).not.toHaveProperty('botToken');
        expect(update).not.toHaveProperty('signingSecret');
    });

    it('returns only account-scoped Slack settings and signing candidates', async () => {
        client.findOne.mockResolvedValue({
            botToken: 'account-token',
            channelId: 'account-channel',
            signingSecret: 'account-secret'
        });
        await expect(getSlackSettings('Person@Example.com')).resolves.toEqual({
            botToken: 'account-token',
            channelId: 'account-channel',
            signingSecret: 'account-secret'
        });

        eventCursor.toArray.mockResolvedValue([{
            accountEmail: 'Person@Example.com',
            signingSecret: 'account-secret'
        }]);
        await expect(getSlackSigningCandidates()).resolves.toEqual([{
            email: 'person@example.com',
            signingSecret: 'account-secret'
        }]);
    });

    it('lists only Ring tokens belonging to accounts', async () => {
        eventCursor.toArray.mockResolvedValue([
            { accountEmail: 'Person@Example.com', value: 'account-token' }
        ]);
        await expect(listRingAccounts()).resolves.toEqual([
            { email: 'person@example.com', refreshToken: 'account-token' }
        ]);
        expect(client.find).toHaveBeenCalledWith(
            { type: 'refreshToken', accountEmail: { $type: 'string' }, value: { $type: 'string', $ne: '' } },
            { projection: { _id: 0, accountEmail: 1, value: 1 } }
        );
    });

});
