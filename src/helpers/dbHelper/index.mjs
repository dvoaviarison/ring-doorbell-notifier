import "dotenv/config";
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { purgeLocalFiles } from '../fileHelper/index.mjs';
import { logger } from "../logHelper/index.mjs";
import { eventCategories, eventCategoryList } from '../eventCategories/index.mjs';
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
const accountConfigKey = (email, name) => `account:${email}:${name}`;

export async function getRingOwnershipCollection() {
    await client.connect();
    return client.db(dbName).collection('ringOwnership');
}

export async function deleteAccountRefreshToken(email) {
    const accountEmail = normalizeEmail(email);
    await client.connect();
    await client.db(dbName).collection(configCollectionName).deleteOne({
        key: accountConfigKey(accountEmail, 'refreshToken'), accountEmail
    });
}
const legacyEventCategories = new Map([
    ['car passing by', 'vehicle'],
    ['person(s)', 'person'],
    ['animals', 'animal']
]);

function normalizeEmail(email) {
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw new TypeError('A Google account email is required.');
    }
    return email.trim().toLowerCase();
}

function validateRingAccountId(ringAccountId) {
    if (typeof ringAccountId !== 'string' || !/^[1-9]\d*$/.test(ringAccountId)) {
        throw new TypeError('A verified Ring account ID is required.');
    }
    return ringAccountId;
}

async function getAccountConfig(email, name) {
    const accountEmail = normalizeEmail(email);
    await client.connect();
    return client.db(dbName).collection(configCollectionName).findOne({
        key: accountConfigKey(accountEmail, name),
        accountEmail
    });
}

export async function getRefreshToken(email) {
    const accountEmail = normalizeEmail(email);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(configCollectionName);
        const refreshToken = await collection.findOne({
            key: accountConfigKey(accountEmail, 'refreshToken'),
            accountEmail
        });
        if (typeof refreshToken?.value !== 'string' || !refreshToken.value) {
            throw new Error('No Ring refresh token found for this account. Sign in through A-Eye or the Ring authentication API.');
        }

        return refreshToken.value;
    }
    catch (error) {
        logger.error('Error connecting to MongoDB or fetching the account refresh token.');
        throw error;
    }
}

export async function storeRefreshToken(refreshToken, email) {
    const accountEmail = normalizeEmail(email);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(configCollectionName);

        const result = await collection.updateOne(
            { key: accountConfigKey(accountEmail, 'refreshToken'), accountEmail },
            { $set: { value: refreshToken, accountEmail, type: 'refreshToken' } },
            { upsert: true } 
        );

        logger.info(`Account Ring refresh token stored. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}, Upserted: ${result.upsertedCount}`);
    } catch (err) {
        logger.error('Error connecting to MongoDB or storing the account refresh token.');
        throw err;
    }
}

export async function listRingAccounts() {
    try {
        await client.connect();
        const collection = client.db(dbName).collection(configCollectionName);
        const tokens = await collection.find(
            { type: 'refreshToken', accountEmail: { $type: 'string' }, value: { $type: 'string', $ne: '' } },
            { projection: { _id: 0, accountEmail: 1, value: 1 } }
        ).toArray();
        return tokens
            .filter(({ accountEmail, value }) => typeof accountEmail === 'string' && accountEmail && typeof value === 'string' && value)
            .map(({ accountEmail, value }) => ({ email: normalizeEmail(accountEmail), refreshToken: value }));
    } catch (error) {
        logger.error('Error connecting to MongoDB or listing Ring accounts.');
        throw error;
    }
}

export async function getSlackSettings(email) {
    const accountEmail = normalizeEmail(email);
    try {
        const settings = await getAccountConfig(accountEmail, 'slackSettings');
        if (!settings) return null;
        return {
            ...(typeof settings.botToken === 'string' ? { botToken: settings.botToken } : {}),
            ...(typeof settings.channelId === 'string' ? { channelId: settings.channelId } : {}),
            ...(typeof settings.signingSecret === 'string' ? { signingSecret: settings.signingSecret } : {})
        };
    } catch (error) {
        logger.error('Error connecting to MongoDB or fetching account Slack settings.');
        throw error;
    }
}

export async function updateSlackSettings(email, patch = {}) {
    const accountEmail = normalizeEmail(email);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('Slack settings patch must be an object.');
    }
    const allowedFields = ['botToken', 'channelId', 'signingSecret'];
    const update = Object.fromEntries(allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== undefined)
        .map((field) => [field, patch[field]]));
    if (Object.values(update).some((value) => typeof value !== 'string')) {
        throw new TypeError('Slack settings values must be strings.');
    }
    if (!Object.keys(update).length) return getSlackSettings(accountEmail);

    try {
        await client.connect();
        const collection = client.db(dbName).collection(configCollectionName);
        await collection.updateOne(
            { key: accountConfigKey(accountEmail, 'slackSettings'), accountEmail },
            { $set: { ...update, accountEmail, key: accountConfigKey(accountEmail, 'slackSettings'), type: 'slackSettings' } },
            { upsert: true }
        );
        return getSlackSettings(accountEmail);
    } catch (error) {
        logger.error('Error connecting to MongoDB or updating account Slack settings.');
        throw error;
    }
}

export async function getPushCategories(email) {
    const accountEmail = normalizeEmail(email);
    try {
        const settings = await getAccountConfig(accountEmail, 'pushCategories');
        if (!Array.isArray(settings?.value)) return [...eventCategoryList];
        return eventCategoryList.filter((category) => settings.value.includes(category));
    } catch (error) {
        logger.error('Error connecting to MongoDB or fetching push notification categories:', error);
        throw error;
    }
}

export async function setPushCategories(email, categories) {
    const accountEmail = normalizeEmail(email);
    if (!Array.isArray(categories) || categories.some((category) => !eventCategories.has(category))) {
        throw new TypeError('Push notification categories must be a list of valid event categories.');
    }
    const value = eventCategoryList.filter((category) => categories.includes(category));
    try {
        await client.connect();
        const key = accountConfigKey(accountEmail, 'pushCategories');
        await client.db(dbName).collection(configCollectionName).updateOne(
            { key, accountEmail },
            { $set: { key, accountEmail, type: 'pushCategories', value } },
            { upsert: true }
        );
        return value;
    } catch (error) {
        logger.error('Error connecting to MongoDB or updating push notification categories:', error);
        throw error;
    }
}

export async function getSlackSigningCandidates() {
    try {
        await client.connect();
        const collection = client.db(dbName).collection(configCollectionName);
        const settings = await collection.find(
            { type: 'slackSettings', accountEmail: { $type: 'string' }, signingSecret: { $type: 'string', $ne: '' } },
            { projection: { _id: 0, accountEmail: 1, signingSecret: 1 } }
        ).toArray();
        return settings
            .filter(({ accountEmail, signingSecret }) => typeof accountEmail === 'string' && accountEmail &&
                typeof signingSecret === 'string' && signingSecret)
            .map(({ accountEmail, signingSecret }) => ({
                email: normalizeEmail(accountEmail),
                signingSecret
            }));
    } catch (error) {
        logger.error('Error connecting to MongoDB or loading Slack signing candidates.');
        throw error;
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

export async function storeVideoEvent(description, megaLink, timestamp = new Date(), videoFileName, cameraName, category = null, ringAccountId, ringEventId) {
    const id = validateRingAccountId(ringAccountId);
    const thumbnailLink = await uploadVideoThumbnail(videoFileName);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(eventsCollectionName);
        const event = {
            timestamp,
            description: removeSlackChannelPrefix(description),
            category,
            megaLink,
            ...(typeof cameraName === 'string' && cameraName ? { cameraName } : {}),
            ...(typeof thumbnailLink === 'string' && thumbnailLink ? { thumbnailLink } : {}),
            ringAccountId: id
        };
        if (typeof ringEventId === 'string' && ringEventId) {
            const eventId = new ObjectId(createHash('sha256').update(`${id}:${ringEventId}`).digest('hex').slice(0, 24));
            try {
                await collection.updateOne({ _id: eventId }, { $setOnInsert: event }, { upsert: true });
            } catch (error) {
                if (error.code !== 11000 || !await collection.findOne({ _id: eventId, ringAccountId: id })) throw error;
            }
        } else {
            await collection.insertOne(event);
        }
    } catch (error) {
        logger.error('Error connecting to MongoDB or storing Mega upload event:', error);
        throw error;
    }
}

export async function getVideoEventsForDay(start, end, ringAccountId) {
    const id = validateRingAccountId(ringAccountId);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(eventsCollectionName);
        const events = await collection.find(
            { ringAccountId: id, timestamp: { $gte: start, $lt: end } },
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

export async function getVideoEventThumbnailLink(id, ringAccountId) {
    const ownerId = validateRingAccountId(ringAccountId);
    if (!ObjectId.isValid(id)) {
        return null;
    }

    try {
        await client.connect();
        const collection = client.db(dbName).collection(eventsCollectionName);
        const event = await collection.findOne(
            { _id: new ObjectId(id), ringAccountId: ownerId },
            { projection: { _id: 0, thumbnailLink: 1 } }
        );
        return typeof event?.thumbnailLink === 'string' ? event.thumbnailLink : null;
    } catch (error) {
        logger.error('Error connecting to MongoDB or loading video thumbnail:', error);
        throw error;
    }
}

export async function getVideoEventMegaLink(id, ringAccountId) {
    const ownerId = validateRingAccountId(ringAccountId);
    if (!ObjectId.isValid(id)) {
        return null;
    }

    try {
        await client.connect();
        const collection = client.db(dbName).collection(eventsCollectionName);
        const event = await collection.findOne(
            { _id: new ObjectId(id), ringAccountId: ownerId },
            { projection: { _id: 0, megaLink: 1 } }
        );
        return typeof event?.megaLink === 'string' ? event.megaLink : null;
    } catch (error) {
        logger.error('Error connecting to MongoDB or loading video event:', error);
        throw error;
    }
}

export async function storePushSubscription(subscription, email) {
    const accountEmail = normalizeEmail(email);
    if (typeof subscription?.endpoint !== 'string' || !subscription.endpoint) {
        throw new TypeError('A valid push subscription endpoint is required.');
    }
    try {
        await client.connect();
        const collection = client.db(dbName).collection(pushSubscriptionsCollectionName);
        await collection.createIndex({ endpoint: 1 }, { unique: true });
        await collection.updateOne(
            { endpoint: subscription.endpoint },
            { $set: { endpoint: subscription.endpoint, accountEmail, subscription, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        logger.error('Error connecting to MongoDB or storing push subscription:', error);
        throw error;
    }
}

export async function getPushSubscriptions(email) {
    const accountEmail = normalizeEmail(email);
    try {
        await client.connect();
        const collection = client.db(dbName).collection(pushSubscriptionsCollectionName);
        return await collection.find(
            { accountEmail },
            { projection: { _id: 0, endpoint: 1, accountEmail: 1, subscription: 1 } }
        ).toArray();
    } catch (error) {
        logger.error('Error connecting to MongoDB or fetching push subscriptions:', error);
        throw error;
    }
}

export async function deletePushSubscription(endpoint, email) {
    const accountEmail = normalizeEmail(email);
    try {
        await client.connect();
        const collection = client.db(dbName).collection(pushSubscriptionsCollectionName);
        await collection.deleteOne({ endpoint, accountEmail });
    } catch (error) {
        logger.error('Error connecting to MongoDB or deleting push subscription:', error);
        throw error;
    }
}
