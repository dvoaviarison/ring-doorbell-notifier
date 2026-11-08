import "dotenv/config";
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';
import path from 'node:path';
import { purgeLocalFiles } from '../fileHelper/index.mjs';
import { logger } from "../logHelper/index.mjs";
import { removeSlackChannelPrefix } from '../messageHelper/index.mjs';
import { trackPendingUpload } from '../pendingUploadHelper/index.mjs';
import { uploadFileToMega } from '../uploadHelper/index.mjs';
import { createVideoThumbnail } from '../videoThumbnailHelper/index.mjs';

const { env } = process;
const client = new MongoClient(env.MONGO_DB_CONNECTION_STRING, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
const dbName = env.MONGO_DB_NAME || 'ringnotifier';
const configCollectionName = env.MONGO_DB_COLLECTION_NAME || 'configuration';
const eventsCollectionName = env.MONGO_DB_EVENTS_COLLECTION_NAME || 'events';
const pushSubscriptionsCollectionName = env.MONGO_DB_PUSH_SUBSCRIPTIONS_COLLECTION_NAME || 'pushSubscriptions';
const legacyEventCategories = new Map([
    ['car passing by', 'vehicle'],
    ['person(s)', 'person'],
    ['animals', 'animal']
]);

export async function getRefreshToken() {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(configCollectionName);
        const refreshToken = await collection.findOne({ key: 'refreshToken' });
        if (typeof refreshToken?.value !== 'string' || !refreshToken.value) {
            throw new Error('No Ring refresh token found in MongoDB. Sign in through A-Eye or the Ring authentication API.');
        }

        logger.info('Refresh token found in the database.');
        return refreshToken.value;
    }
    catch (error) {
        logger.error('Error connecting to MongoDB or fetching refresh token:', error);
        throw error;
    }
}

export async function storeRefreshToken(refreshToken) {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(configCollectionName);

        const result = await collection.updateOne(
            { key: "refreshToken" }, 
            { $set: { value: refreshToken } }, 
            { upsert: true } 
        );

        logger.info(
            `Refresh token stored successfully. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}, Upserted: ${result.upsertedCount}`
        );
    } catch (err) {
        logger.error('Error connecting to MongoDB or storing refresh token:', err);
        throw err;
    }
}

async function uploadVideoThumbnail(videoFileName) {
    if (typeof videoFileName !== 'string' || !videoFileName) {
        return null;
    }

    const thumbnailFileName = `${path.basename(videoFileName, path.extname(videoFileName))}.jpg`;
    const recordingFolder = env.APP_RECORDING_FOLDER;
    const releaseVideo = recordingFolder
        ? trackPendingUpload(path.join(recordingFolder, videoFileName))
        : () => {};
    const releaseThumbnail = recordingFolder
        ? trackPendingUpload(path.join(recordingFolder, thumbnailFileName))
        : () => {};

    try {
        try {
            await createVideoThumbnail(videoFileName);
        } catch (error) {
            logger.error('Failed to generate video thumbnail:', error);
            return null;
        }

        const thumbnailLink = await uploadFileToMega(thumbnailFileName);
        return typeof thumbnailLink === 'string' && thumbnailLink ? thumbnailLink : null;
    } catch (error) {
        logger.error('Failed to upload video thumbnail to Mega:', error);
        return null;
    } finally {
        releaseVideo();
        releaseThumbnail();
        purgeLocalFiles();
    }
}

export async function storeVideoEvent(description, megaLink, timestamp = new Date(), videoFileName, cameraName, category = null) {
    const thumbnailLink = await uploadVideoThumbnail(videoFileName);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(eventsCollectionName);
        await collection.insertOne({
            timestamp,
            description: removeSlackChannelPrefix(description),
            category,
            megaLink,
            ...(typeof cameraName === 'string' && cameraName ? { cameraName } : {}),
            ...(typeof thumbnailLink === 'string' && thumbnailLink ? { thumbnailLink } : {})
        });
    } catch (error) {
        logger.error('Error connecting to MongoDB or storing Mega upload event:', error);
        throw error;
    }
}

export async function getVideoEventsForDay(start, end) {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(eventsCollectionName);
        const events = await collection.find(
            { timestamp: { $gte: start, $lt: end } },
            { projection: { _id: 1, timestamp: 1, description: 1, category: 1, megaLink: 1, thumbnailLink: 1, cameraName: 1 } }
        )
            .sort({ timestamp: -1 })
            .toArray();
        return events.map(({ _id, ...event }) => ({
            ...event,
            ...(legacyEventCategories.has(event.category) ? { category: legacyEventCategories.get(event.category) } : {}),
            id: _id.toString()
        }));
    } catch (error) {
        logger.error('Error connecting to MongoDB or fetching daily Mega upload events:', error);
        throw error;
    }
}

export async function getVideoEventThumbnailLink(id) {
    if (!ObjectId.isValid(id)) {
        return null;
    }

    try {
        await client.connect();
        const collection = client.db(dbName).collection(eventsCollectionName);
        const event = await collection.findOne(
            { _id: new ObjectId(id) },
            { projection: { _id: 0, thumbnailLink: 1 } }
        );
        return typeof event?.thumbnailLink === 'string' ? event.thumbnailLink : null;
    } catch (error) {
        logger.error('Error connecting to MongoDB or loading video thumbnail:', error);
        throw error;
    }
}

export async function getVideoEventMegaLink(id) {
    if (!ObjectId.isValid(id)) {
        return null;
    }

    try {
        await client.connect();
        const collection = client.db(dbName).collection(eventsCollectionName);
        const event = await collection.findOne(
            { _id: new ObjectId(id) },
            { projection: { _id: 0, megaLink: 1 } }
        );
        return typeof event?.megaLink === 'string' ? event.megaLink : null;
    } catch (error) {
        logger.error('Error connecting to MongoDB or loading video event:', error);
        throw error;
    }
}

export async function storePushSubscription(subscription) {
    try {
        await client.connect();
        const collection = client.db(dbName).collection(pushSubscriptionsCollectionName);
        await collection.updateOne(
            { endpoint: subscription.endpoint },
            { $set: { endpoint: subscription.endpoint, subscription, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        logger.error('Error connecting to MongoDB or storing push subscription:', error);
        throw error;
    }
}

export async function getPushSubscriptions() {
    try {
        await client.connect();
        const collection = client.db(dbName).collection(pushSubscriptionsCollectionName);
        return await collection.find({}, { projection: { _id: 0, endpoint: 1, subscription: 1 } }).toArray();
    } catch (error) {
        logger.error('Error connecting to MongoDB or fetching push subscriptions:', error);
        throw error;
    }
}

export async function deletePushSubscription(endpoint) {
    try {
        await client.connect();
        const collection = client.db(dbName).collection(pushSubscriptionsCollectionName);
        await collection.deleteOne({ endpoint });
    } catch (error) {
        logger.error('Error connecting to MongoDB or deleting push subscription:', error);
        throw error;
    }
}
