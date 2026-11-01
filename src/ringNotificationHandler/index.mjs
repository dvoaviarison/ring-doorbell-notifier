import "dotenv/config";
import { getFormattedDateTime } from '../helpers/dateHelper/index.mjs';
import { sendSlackNotificationWithVideo } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs';
import { formatMessage } from '../helpers/messageHelper/index.mjs';
import { logger } from "../helpers/logHelper/index.mjs";

const { env } = process;
const recordingDurationSec = 10;

export async function handleRingNotification(camera, notif) {
    const videoFileName = `${camera.name}-${getFormattedDateTime()}.mp4`;
    const message = formatMessage(notif.android_config.body);

    logger.info('Recording video...');
    await camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec);
    logger.info('Video recorded. Uploading');

    logger.info('Uploading video to Mega and Slack...');
    const uploadResults = await Promise.allSettled([
        uploadFileToMega(videoFileName),
        sendSlackNotificationWithVideo(message, videoFileName)
    ]);
    const uploadErrors = uploadResults
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
    if (uploadErrors.length > 0) {
        throw new AggregateError(uploadErrors, 'Failed to upload the video to Mega and/or Slack.');
    }
    logger.info('Video uploaded to Mega and attached to Slack');

    return message;
}