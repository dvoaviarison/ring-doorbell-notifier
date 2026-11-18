import { File } from 'megajs';
import { getOldestVideoEventsToArchive, markVideoEventsArchived } from '../dbHelper/index.mjs';
import { logger } from '../logHelper/index.mjs';
import { openMegaStorage } from '../uploadHelper/index.mjs';

const usageThreshold = 0.9;
const archiveWindowDays = 30;
const minCheckIntervalMs = 10 * 60 * 1000;
const cleanupInProgress = new Set();
const lastCheckAt = new Map();

function findStorageNode(storage, link) {
    if (typeof link !== 'string' || !link) return null;
    try {
        return storage.files[File.fromURL(link).nodeId] ?? null;
    } catch {
        return null;
    }
}

export async function archiveOldEventsIfStorageFull(ownerEmail, ringAccountId, credentials) {
    if (cleanupInProgress.has(ownerEmail) || Date.now() - (lastCheckAt.get(ownerEmail) ?? 0) < minCheckIntervalMs) return 0;
    cleanupInProgress.add(ownerEmail);
    lastCheckAt.set(ownerEmail, Date.now());
    let storage;
    try {
        storage = await openMegaStorage(credentials);
        const { spaceUsed, spaceTotal } = await storage.getAccountInfo();
        if (!(spaceTotal > 0) || spaceUsed / spaceTotal < usageThreshold) return 0;

        logger.info(`MEGA storage is ${Math.round((spaceUsed / spaceTotal) * 100)}% full; archiving the oldest ${archiveWindowDays} days of events.`);
        const events = await getOldestVideoEventsToArchive(archiveWindowDays, ringAccountId, credentials.email);
        const archivedIds = [];
        for (const event of events) {
            try {
                for (const link of [event.megaLink, event.thumbnailLink]) {
                    await findStorageNode(storage, link)?.delete(true);
                }
                archivedIds.push(event.id);
            } catch (error) {
                logger.error(`Could not delete MEGA files for event ${event.id}; leaving it unarchived.`, error);
            }
        }
        await markVideoEventsArchived(archivedIds);
        logger.info(`Archived ${archivedIds.length} events and deleted their MEGA files.`);
        return archivedIds.length;
    } finally {
        storage?.close();
        cleanupInProgress.delete(ownerEmail);
    }
}
