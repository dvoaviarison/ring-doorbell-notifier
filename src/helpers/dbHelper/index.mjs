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

export async function getRefreshToken() {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(configCollectionName);
        const refreshToken = await collection.findOne({ key: 'refreshToken' });
        if (refreshToken) {
            logger.info(`Refresh token found: ${refreshToken.value.substring(0, 10)}...`);
            return refreshToken.value;
        } else {
            logger.warn('No refresh token found in the database.');
            return env.RING_REFRESH_TOKEN;;
        }
    }
    catch (error) {
        logger.error('Error connecting to MongoDB or fetching refresh token:', error);
        return env.RING_REFRESH_TOKEN;
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
    } finally {
        await client.close();
    }
}

