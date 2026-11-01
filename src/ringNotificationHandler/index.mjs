import "dotenv/config";
import { getFormattedDateTime } from '../helpers/dateHelper/index.mjs';
import { sendSlackNotificationWithVideo } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs';
import { formatMessage } from '../helpers/messageHelper/index.mjs';
import { getAIPoweredVideoDescription } from '../helpers/aiHelper/index.mjs';
import { purgeLocalFiles } from '../helpers/fileHelper/index.mjs';
import { trackPendingUpload } from '../helpers/pendingUploadHelper/index.mjs';
import { logger } from "../helpers/logHelper/index.mjs";

const { env } = process;
const recordingDurationSec = 10;

export async function handleRingNotification(camera, notif) {
    const videoFileName = `${camera.name}-${getFormattedDateTime()}.mp4`;

    logger.info('Recording video...');
    await camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec);
    logger.info('Video recorded. Uploading');

    const releaseSlackFile = trackPendingUpload(`${env.APP_RECORDING_FOLDER}/${videoFileName}`);
    void uploadFileToMega(videoFileName)
        .then(() => logger.info('Video uploaded to Mega'))
        .catch((error) => logger.error('Failed to upload video to Mega:', error));

    const descriptionPromise = env.APP_ENABLE_AI === 'true'
        ? getAIPoweredVideoDescription(videoFileName, camera.name)
            .then((description) => description || notif.android_config.body)
            .catch((error) => {
                logger.error('Could not generate an AI description; using the Ring notification text:', error);
                return notif.android_config.body;
            })
        : Promise.resolve(notif.android_config.body);
    const messageBody = await descriptionPromise;

    const message = formatMessage(messageBody);
    logger.info('Sending Slack notification with video...');
    try {
        await sendSlackNotificationWithVideo(message, videoFileName);
    } catch (error) {
        logger.error('Failed to send video to Slack; keeping the recording for retry:', error);
        throw error;
    }

    releaseSlackFile();
    purgeLocalFiles();
    logger.info('Video attached to Slack');

    return message;
}