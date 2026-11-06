import "dotenv/config";
import { MongoClient, ServerApiVersion } from 'mongodb';
import { logger } from "../logHelper/index.mjs";

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

export async function getRefreshToken() {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(configCollectionName);
        const refreshToken = await collection.findOne({ key: 'refreshToken' });
        if (typeof refreshToken?.value !== 'string' || !refreshToken.value) {
            throw new Error('No Ring refresh token found in MongoDB. Sign in through the web UI to connect.');
        }

        logger.info('Refresh token found in the database.');
        return refreshToken.value;
    }
    catch (error) {
        logger.error('Error connecting to MongoDB or fetching refresh token:', error);
        throw error;
    } finally {
        await client.close();
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
    } finally {
        await client.close();
    }
}

export async function storeVideoEvent(description, megaLink, timestamp = new Date()) {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(eventsCollectionName);
        await collection.insertOne({
            timestamp,
            description,
            megaLink
        });
    } catch (error) {
        logger.error('Error connecting to MongoDB or storing Mega upload event:', error);
        throw error;
    } finally {
        await client.close();
    }
}

export async function getVideoEventsForDay(start, end) {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(eventsCollectionName);
        return await collection.find(
            { timestamp: { $gte: start, $lt: end } },
            { projection: { _id: 0, timestamp: 1, description: 1, megaLink: 1 } }
        )
            .sort({ timestamp: -1 })
            .toArray();
    } catch (error) {
        logger.error('Error connecting to MongoDB or fetching daily Mega upload events:', error);
        throw error;
    } finally {
        await client.close();
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
    } finally {
        await client.close();
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
    } finally {
        await client.close();
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
    } finally {
        await client.close();
    }
}
