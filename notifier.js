import "dotenv/config";
import { RingApi } from 'ring-client-api';
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { getFormattedDateTime } from './helpers/dateHelper.js';
import { sendSlackNotificationWithSnapshot, sendSimpleSlackNotification } from './helpers/notificationHelper.js';
import { uploadFileToMega } from './helpers/uploadHelper.js'
import { formatMessage } from './helpers/messageHelper.js';

const recordingDurationSec = 20;
const snapshotFromVideoSecond = 1;
const { env } = process;

async function takeSnapshotFromVideo(videoFileName, timeSecond, snapshotFileName) {
    const videoFilePath = `${env.APP_RECORDING_FOLDER}/${videoFileName}`;
    return new Promise((resolve) => {
        ffmpeg(videoFilePath)
            .screenshots({
                timestamps: [timeSecond],
                filename: snapshotFileName,
                folder: env.APP_RECORDING_FOLDER
            })
            .on('end', () => {
                resolve(true);
            })
            .on('error', (err) => {
                console.log(err);
                resolve(false);
            });
    });
}

function deleteLocalFileByName(fileName) {
    const filePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    fs.unlink(filePath, () => {
        console.log(`File deleted successfully: ${fileName}`);
    });
}

export async function run() {
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
                // Record Video
                const videoFileName = `${notif.data.device.name}-${getFormattedDateTime()}.mp4`;
                camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec).then(async () => {
                    // Upload Video
                    const videoUrl = await uploadFileToMega(videoFileName);

                    // Take a snapshot
                    const snapshotFileName = `${notif.data.device.name}-${getFormattedDateTime()}.jpg`;
                    const hasSnapshot = await takeSnapshotFromVideo(videoFileName, snapshotFromVideoSecond, snapshotFileName);

                    // Send notification
                    if (videoUrl) {
                        console.log('Sending Notification...');
                        const liveUrl = `https://account.ring.com/account/dashboard?lv_d=${notif.data.device.id}`;
                        var message = formatMessage(
                            notif.android_config.body, 
                            videoUrl ? videoUrl : liveUrl);
                        if (hasSnapshot){
                            sendSlackNotificationWithSnapshot(message, snapshotFileName);
                            deleteLocalFileByName(videoFileName);
                            deleteLocalFileByName(snapshotFileName);
                            console.log('Notification sent with snapshiot');
                        } else {
                            sendSimpleSlackNotification(message);
                            deleteLocalFileByName(videoFileName);
                            console.log('Notification sent without snapshot');
                        }
                    }
                });
            });
        });
    });
} 
