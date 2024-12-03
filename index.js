import "dotenv/config";
import { RingApi } from 'ring-client-api';
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import fs from 'fs';
import { getFormattedDateTime } from './helpers/dateHelper.js';
import { sendSlackNotificationWithSnapshot, sendSimpleSlackNotification } from './helpers/notificationHelper.js';
import { uploadFileToMega } from './helpers/uploadHelper.js'
import { formatMessage } from './helpers/messageHelper.js';

const recordingDurationSec = 20;
const { env } = process;

async function run() {
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
                // Take a snapshot
                const snapshotFileName = `${notif.data.device.name}-${getFormattedDateTime()}.jpg`;
                var hasSnapShot = true;
                try {
                    const snapshotBuffer = await camera.getSnapshot();
                    fs.writeFileSync(`${env.APP_RECORDING_FOLDER}/${snapshotFileName}`, snapshotBuffer);
                } catch (err) {
                    console.log(error);
                    hasSnapShot = false
                }

                // Record Video
                const videoFileName = `${notif.data.device.name}-${getFormattedDateTime()}.mp4`;
                camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec).then(async () => {
                    // Upload Video
                    const videoUrl = await uploadFileToMega(videoFileName);
                    // Send notification
                    if (videoUrl) {
                        const liveUrl = `https://account.ring.com/account/dashboard?lv_d=${notif.data.device.id}`;
                        var message = formatMessage(
                            notif.android_config.body, 
                            videoUrl ? videoUrl : liveUrl);
                        if (hasSnapShot){
                            sendSlackNotificationWithSnapshot(message, snapshotFileName);
                        } else {
                            sendSimpleSlackNotification(message);
                        }
                    }
                });
            });
        });
    });
}

const runWithExceptionRecovery = async () => {
    try {
        await run();
    } catch (error) {
      console.error('Error caught:', error.message);
      console.log('Restarting...');
      await new Promise(res => setTimeout(res, 1000)); // Wait 1 second before restarting
      runWithExceptionRecovery(); // Restart the function
    }
  };
  
  // Start the main function
  runWithExceptionRecovery();
  
