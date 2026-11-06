jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        db: jest.fn(),
        collection: jest.fn(),
        findOne: jest.fn(),
        updateOne: jest.fn(),
        insertOne: jest.fn(),
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

import { MongoClient, ObjectId } from 'mongodb';
import {
    getVideoEventsForDay,
    getVideoEventMegaLink,
    getRefreshToken,
    storeRefreshToken,
    storeVideoEvent,
    storePushSubscription,
    getPushSubscriptions,
    deletePushSubscription
} from './index.mjs';

const client = MongoClient.mock.results[0].value;
const eventCursor = {
    sort: jest.fn(),
    toArray: jest.fn()
};

describe('Ring refresh token persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        client.connect.mockResolvedValue(undefined);
        client.db.mockReturnValue(client);
        client.collection.mockReturnValue(client);
        client.findOne.mockResolvedValue({ value: 'stored-token' });
        client.updateOne.mockResolvedValue({
            matchedCount: 0,
            modifiedCount: 0,
            upsertedCount: 1
        });
        client.insertOne.mockResolvedValue({ insertedId: 'event-id' });
        client.find.mockReturnValue(eventCursor);
        eventCursor.sort.mockReturnValue(eventCursor);
        eventCursor.toArray.mockResolvedValue([]);
        client.close.mockResolvedValue(undefined);
    });

    it('loads the refresh token from MongoDB', async () => {
        await expect(getRefreshToken()).resolves.toBe('stored-token');
        expect(client.findOne).toHaveBeenCalledWith({ key: 'refreshToken' });
        expect(client.close).toHaveBeenCalled();
    });

    it('requires Ring sign-in when MongoDB has no refresh token', async () => {
        client.findOne.mockResolvedValue(null);

        await expect(getRefreshToken())
            .rejects.toThrow('No Ring refresh token found in MongoDB. Sign in through the web UI to connect.');
        expect(client.close).toHaveBeenCalled();
    });

    it('propagates MongoDB errors instead of falling back to an environment token', async () => {
        const error = new Error('MongoDB unavailable');
        client.connect.mockRejectedValue(error);

        await expect(getRefreshToken()).rejects.toBe(error);
    });

    it('stores the refresh token in MongoDB', async () => {
        await storeRefreshToken('new-token');

        expect(client.updateOne).toHaveBeenCalledWith(
            { key: 'refreshToken' },
            { $set: { value: 'new-token' } },
            { upsert: true }
        );
        expect(client.close).toHaveBeenCalled();
    });

    it('stores a video event with a UTC timestamp, Slack description, and Mega link', async () => {
        const timestamp = new Date('2026-11-06T12:00:00.000Z');

        await storeVideoEvent('@channel: Motion detected', 'https://mega.example/video', timestamp);

        expect(client.insertOne).toHaveBeenCalledWith({
            timestamp,
            description: '@channel: Motion detected',
            megaLink: 'https://mega.example/video'
        });
        expect(client.db).toHaveBeenCalledWith('ringnotifier');
        expect(client.collection).toHaveBeenCalledWith('events');
        expect(client.close).toHaveBeenCalled();
    });

    it('loads a selected UTC day of video events newest first', async () => {
        const events = [{ _id: { toString: () => 'event-id' }, description: 'Motion detected' }];
        const start = new Date('2026-11-06T00:00:00.000Z');
        const end = new Date('2026-11-07T00:00:00.000Z');
        eventCursor.toArray.mockResolvedValue(events);

        await expect(getVideoEventsForDay(start, end)).resolves.toEqual([
            { id: 'event-id', description: 'Motion detected' }
        ]);

        expect(client.find).toHaveBeenCalledWith(
            { timestamp: { $gte: start, $lt: end } },
            { projection: { _id: 1, timestamp: 1, description: 1, megaLink: 1 } }
        );
        expect(eventCursor.sort).toHaveBeenCalledWith({ timestamp: -1 });
        expect(client.close).toHaveBeenCalled();
    });

    it('loads a MEGA link by event id for in-page video playback', async () => {
        client.findOne.mockResolvedValue({ megaLink: 'https://mega.nz/file/id#key' });

        await expect(getVideoEventMegaLink('0123456789abcdef01234567'))
            .resolves.toBe('https://mega.nz/file/id#key');

        expect(ObjectId).toHaveBeenCalledWith('0123456789abcdef01234567');
        expect(client.findOne).toHaveBeenCalledWith(expect.objectContaining({
            _id: expect.objectContaining({ value: '0123456789abcdef01234567' })
        }), { projection: { _id: 0, megaLink: 1 } });
        expect(client.close).toHaveBeenCalled();
    });

    it('rejects invalid event ids without querying MongoDB', async () => {
        await expect(getVideoEventMegaLink('not-an-id')).resolves.toBeNull();
        expect(client.findOne).not.toHaveBeenCalled();
    });

    it('upserts browser push subscriptions by endpoint', async () => {
        const subscription = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/test',
            keys: { p256dh: 'public-key', auth: 'auth-secret' }
        };
        await storePushSubscription(subscription);

        expect(client.updateOne).toHaveBeenCalledWith(
            { endpoint: subscription.endpoint },
            expect.objectContaining({
                $set: expect.objectContaining({ endpoint: subscription.endpoint, subscription })
            }),
            { upsert: true }
        );
        expect(client.collection).toHaveBeenCalledWith('pushSubscriptions');
        expect(client.close).toHaveBeenCalled();
    });

    it('loads stored browser push subscriptions', async () => {
        const subscriptions = [{ endpoint: 'https://fcm.googleapis.com/fcm/send/test' }];
        eventCursor.toArray.mockResolvedValue(subscriptions);

        await expect(getPushSubscriptions()).resolves.toBe(subscriptions);
        expect(client.find).toHaveBeenCalledWith(
            {},
            { projection: { _id: 0, endpoint: 1, subscription: 1 } }
        );
        expect(client.close).toHaveBeenCalled();
    });

    it('deletes a browser push subscription by endpoint', async () => {
        const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
        await deletePushSubscription(endpoint);

        expect(client.deleteOne).toHaveBeenCalledWith({ endpoint });
        expect(client.close).toHaveBeenCalled();
    });
});
