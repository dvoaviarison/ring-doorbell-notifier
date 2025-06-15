import "dotenv/config";
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import { purgeLocalFiles } from './helpers/fileHelper/index.mjs';
import { handleRingNotification } from "./ringNotificationHandler/index.mjs";
import { stopProcessInMs } from "./helpers/processHelper/index.mjs";
import { logger } from "./helpers/logHelper/index.mjs";
import { storeRefreshToken } from "./helpers/dbHelper/index.mjs";

const { env } = process;

export async function run(ringApi) {
    if (env.APP_AUTO_STOP_MS) {
        stopProcessInMs(env.APP_AUTO_STOP_MS);
    }

    // Keep token fresh
    ringApi.onRefreshTokenUpdated.subscribe(
        async ({ newRefreshToken, oldRefreshToken }) => {
            logger.info(`Refresh Token Updated: ${newRefreshToken.substring(0, 10)}...`);
            if (!oldRefreshToken) {
                return;
            }

            const currentConfig = await promisify(readFile)(".env"),
                updatedConfig = currentConfig
                    .toString()
                    .replace(oldRefreshToken, newRefreshToken);

            await promisify(writeFile)(".env", updatedConfig);
            await storeRefreshToken(newRefreshToken);
        }
    );

    // Subscribe to all cameras' notifications
    const allCameras = await ringApi.getCameras();
    const locations = await ringApi.getLocations();
    logger.info(`Found ${allCameras.length} cameras in ${locations.length} locations`);
    
    allCameras?.forEach((camera) => {
        camera.onNewNotification.subscribe(async (notif) => {

            // Handle Notification
            await handleRingNotification(camera, notif);

            // Purge
            purgeLocalFiles();
        });
    });
} 
