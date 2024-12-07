import "dotenv/config";
import { getFormattedDateTime } from '../helpers/dateHelper/index.mjs';
import { sendSlackNotificationWithSnapshot, sendSimpleSlackNotification } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs'
import { formatMessage } from '../helpers/messageHelper/index.mjs';
import { takeSnapshotFromVideo } from '../helpers/videoHelper/index.mjs';

const { env } = process;
const recordingDurationSec = 10;
const snapshotFromVideoSecond = 2;

export async function handleRingNotification(camera, notif) {
    // Record Video
    console.log('Recording video...');
    const videoFileName = `${camera.name}-${getFormattedDateTime()}.mp4`;
    await camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec);
    console.log('Video recorded. Uploading');

    // Upload Video
    const videoUrl = await uploadFileToMega(videoFileName);
    console.log('Video uploaded');

    // Take a snapshot
    console.log('Taking snapshot...');
    const snapshotFileName = `${camera.name}-${getFormattedDateTime()}.jpg`;
    const hasSnapshot = await takeSnapshotFromVideo(videoFileName, snapshotFromVideoSecond, snapshotFileName);
    console.log('Snapshot taken')

    // Send notification
    if (videoUrl) {
        console.log('Sending Notification...');
        const liveUrl = `https://account.ring.com/account/dashboard?lv_d=${camera.id}`;
        var message = formatMessage(
            notif.android_config.body,
            videoUrl ? videoUrl : liveUrl);
        if (hasSnapshot) {
            await sendSlackNotificationWithSnapshot(message, snapshotFileName);
            console.log('Notification sent with snapshot');
        } else {
            await sendSimpleSlackNotification(message);
            console.log('Notification sent without snapshot');
        }
    }
}