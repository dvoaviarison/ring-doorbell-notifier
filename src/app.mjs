import "dotenv/config";
import { RingApi } from 'ring-client-api';
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import { purgeLocalFiles } from './helpers/fileHelper/index.mjs';
import { handleRingNotification } from "./ringNotificationHandler/index.mjs";
import { stopProcessInMs } from "./helpers/processHelper/index.mjs";

const { env } = process;

export async function run() {
    if (env.APP_AUTO_STOP_MS){
        stopProcessInMs(env.APP_AUTO_STOP_MS);
    }

    const ringApi = new RingApi({
        refreshToken: env.RING_REFRESH_TOKEN,
    });

    // Keep token fresh
    ringApi.onRefreshTokenUpdated.subscribe(
        async ({ newRefreshToken, oldRefreshToken }) => {
            console.log("Refresh Token Updated");
            if (!oldRefreshToken) {
                return;
            }

            const currentConfig = await promisify(readFile)(".env"),
                updatedConfig = currentConfig
                    .toString()
                    .replace(oldRefreshToken, newRefreshToken);

            await promisify(writeFile)(".env", updatedConfig);
        }
    );

    // Subscribe to all cameras' notifications
    const locations = await ringApi.getLocations();
    locations?.forEach(location => {
        location.cameras?.forEach(camera => {
            camera.onNewNotification.subscribe(async (notif) => {

                // Handle Notification
                await handleRingNotification(camera, notif);

                // Purge
                purgeLocalFiles(env.APP_AUTO_STOP_MS 
                    ? async () => { 
                        console.log('Restarting the service');
                        process.exit(0);
                    }
                    : () => {}
                );
            });
        });
    }); 
} 
