import "dotenv/config";
import { purgeLocalFiles, updateEnvValue } from './helpers/fileHelper/index.mjs';
import { handleRingNotification } from "./ringNotificationHandler/index.mjs";
import { stopProcessInMs } from "./helpers/processHelper/index.mjs";
import { logger } from "./helpers/logHelper/index.mjs";
import { storeRefreshToken } from "./helpers/dbHelper/index.mjs";

const { env } = process;
let autoStopScheduled = false;

export async function run(ringApi) {
    const subscriptions = [];

    if (env.APP_AUTO_STOP_MS && !autoStopScheduled) {
        stopProcessInMs(env.APP_AUTO_STOP_MS);
        autoStopScheduled = true;
    }

    // Keep token fresh
    subscriptions.push(ringApi.onRefreshTokenUpdated.subscribe(
        async ({ newRefreshToken, oldRefreshToken }) => {
            if (newRefreshToken === oldRefreshToken) {
                return;
            }

            try {
                await storeRefreshToken(newRefreshToken);
                updateEnvValue('RING_REFRESH_TOKEN', newRefreshToken);
                logger.info('Ring refresh token updated in the database and process environment.');
            } catch (error) {
                logger.error('Could not persist the updated Ring refresh token:', error);
            }
        }
    ));

    try {
        // Subscribe to all cameras' notifications
        const allCameras = await ringApi.getCameras();
        const locations = await ringApi.getLocations();
        logger.info(`Found ${allCameras.length} cameras in ${locations.length} locations`);

        allCameras?.forEach((camera) => {
            subscriptions.push(camera.onNewNotification.subscribe(async (notif) => {
                // Handle Notification
                await handleRingNotification(camera, notif);

                // Purge
                purgeLocalFiles();
            }));
        });

        return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
    } catch (error) {
        subscriptions.forEach((subscription) => subscription.unsubscribe());
        throw error;
    }
} 
