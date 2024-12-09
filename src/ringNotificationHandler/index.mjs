import "dotenv/config";
import { getFormattedDateTime } from '../helpers/dateHelper/index.mjs';
import { sendSlackNotificationWithSnapshot, sendSimpleSlackNotification } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs'
import { formatMessage } from '../helpers/messageHelper/index.mjs';
import { takeSnapshotFromVideo } from '../helpers/videoHelper/index.mjs';
import { logger } from "../helpers/logHelper/index.mjs";
import { getAIPoweredSnapshotDescription } from "../helpers/aiHelper/index.mjs";

const { env } = process;
const recordingDurationSec = 10;
const snapshotFromVideoSecond = 2;

export async function handleRingNotification(camera, notif) {
    // Record Video
    logger.info('Recording video...');
    const videoFileName = `${camera.name}-${getFormattedDateTime()}.mp4`;
    await camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec);
    logger.info('Video recorded. Uploading');

    // Upload Video
    const videoUrl = await uploadFileToMega(videoFileName);
    logger.info('Video uploaded');

    // Take a snapshot
    logger.info('Taking snapshot...');
    const snapshotFileName = `${camera.name}-${getFormattedDateTime()}.jpg`;
    const hasSnapshot = await takeSnapshotFromVideo(videoFileName, snapshotFromVideoSecond, snapshotFileName);
    logger.info('Snapshot taken')

    // Send notification
    if (videoUrl) {
        logger.info('Sending Notification...');
        const liveUrl = `https://account.ring.com/account/dashboard?lv_d=${camera.id}`;
        var message = formatMessage(
            hasSnapshot && env.APP_ENABLE_AI ? await getAIPoweredSnapshotDescription(snapshotFileName, camera.name) : notif.android_config.body,
            videoUrl ? videoUrl : liveUrl);
        if (hasSnapshot) {
            await sendSlackNotificationWithSnapshot(message, snapshotFileName);
            logger.info('Notification sent with snapshot');
        } else {
            await sendSimpleSlackNotification(message);
            logger.info('Notification sent without snapshot');
        }
    }
}