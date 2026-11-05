jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        db: jest.fn(),
        collection: jest.fn(),
        findOne: jest.fn(),
        updateOne: jest.fn(),
        close: jest.fn()
    })),
    ServerApiVersion: { v1: 'v1' }
}));

import { MongoClient } from 'mongodb';
import { getRefreshToken, storeRefreshToken } from './index.mjs';

const client = MongoClient.mock.results[0].value;

describe('Ring refresh token persistence', () => {
    beforeEach(() => {
        client.connect.mockResolvedValue(undefined);
        client.db.mockReturnValue(client);
        client.collection.mockReturnValue(client);
        client.findOne.mockResolvedValue({ value: 'stored-token' });
        client.updateOne.mockResolvedValue({
            matchedCount: 0,
            modifiedCount: 0,
            upsertedCount: 1
        });
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
});
