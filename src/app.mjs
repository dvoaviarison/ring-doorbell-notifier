import "dotenv/config";
import { purgeLocalFiles } from './helpers/fileHelper/index.mjs';
import { handleRingNotification } from "./ringNotificationHandler/index.mjs";
import { stopProcessInMs } from "./helpers/processHelper/index.mjs";
import { logger } from "./helpers/logHelper/index.mjs";

const { env } = process;
let autoStopScheduled = false;

export async function run(ringApi, ringAccountId, getRecipients) {
    if (typeof getRecipients !== 'function') {
        throw new TypeError('A recipient lookup is required to run the Ring notifier.');
    }
    const subscriptions = [];

    if (env.APP_AUTO_STOP_MS && !autoStopScheduled) {
        stopProcessInMs(env.APP_AUTO_STOP_MS);
        autoStopScheduled = true;
    }

    try {
        // Subscribe to all cameras' notifications
        const allCameras = await ringApi.getCameras();
        const locations = await ringApi.getLocations();
        logger.info(`Found ${allCameras.length} cameras in ${locations.length} locations`);

        allCameras?.forEach((camera) => {
            subscriptions.push(camera.onNewNotification.subscribe(async (notif) => {
                try {
                    const recipients = await getRecipients();
                    if (recipients.length) await handleRingNotification(camera, notif, recipients, ringAccountId);
                } catch (error) {
                    logger.error('Could not process Ring notification for this account:', error);
                } finally {
                    purgeLocalFiles();
                }
            }));
        });

        return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
    } catch (error) {
        subscriptions.forEach((subscription) => subscription.unsubscribe());
        throw error;
    }
} 
