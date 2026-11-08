import "dotenv/config";
import { getFormattedDateTime } from '../helpers/dateHelper/index.mjs';
import { sendSlackNotificationWithVideo } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs';
import { recordVideoFromCamera } from '../helpers/videoHelper/index.mjs';
import { formatMessage, removeSlackChannelPrefix } from '../helpers/messageHelper/index.mjs';
import { getAIPoweredVideoDescription } from '../helpers/aiHelper/index.mjs';
import { purgeLocalFiles } from '../helpers/fileHelper/index.mjs';
import { trackPendingUpload } from '../helpers/pendingUploadHelper/index.mjs';
import { logger } from "../helpers/logHelper/index.mjs";
import { storeVideoEvent } from '../helpers/dbHelper/index.mjs';
import { notifyPushSubscribers } from '../helpers/pushNotificationHelper/index.mjs';

const { env } = process;
const recordingDurationSec = 10;

export async function handleRingNotification(camera, notif) {
    const videoFileName = `${camera.name}-${getFormattedDateTime()}.mp4`;

    logger.info('Recording video...');
    await recordVideoFromCamera(camera, videoFileName, recordingDurationSec);
    logger.info('Video recorded. Uploading');

    const releaseSlackFile = trackPendingUpload(`${env.APP_RECORDING_FOLDER}/${videoFileName}`);
    const megaUploadPromise = uploadFileToMega(videoFileName);

    const eventPromise = env.APP_ENABLE_AI === 'true'
        ? getAIPoweredVideoDescription(videoFileName, camera.name)
            .catch((error) => {
                logger.error('Could not generate an AI description; using the Ring notification text:', error);
                return { description: notif.android_config.body, category: null };
            })
        : Promise.resolve({ description: notif.android_config.body, category: null });
    const normalizedEventPromise = eventPromise.then(({ description, category }) => {
        const withoutSlackPrefix = removeSlackChannelPrefix(description);
        if (typeof withoutSlackPrefix !== 'string' || typeof camera.name !== 'string' || !camera.name) {
            return { description: withoutSlackPrefix, category };
        }
        const prefix = `${camera.name}:`;
        const trimmed = withoutSlackPrefix.trimStart();
        const normalizedDescription = trimmed.startsWith(prefix)
            ? removeSlackChannelPrefix(trimmed.slice(prefix.length).trimStart())
            : withoutSlackPrefix;
        return { description: normalizedDescription, category };
    });
    const messagePromise = normalizedEventPromise.then(({ description }) => formatMessage(description));

    void megaUploadPromise
        .then(async (megaLink) => {
            const timestamp = new Date();
            logger.info('Video uploaded to Mega');
            if (typeof megaLink !== 'string' || !megaLink) {
                logger.error('Mega upload completed without a link; no upload event was saved.');
                return;
            }

            try {
                const { description, category } = await normalizedEventPromise;
                await storeVideoEvent(description, megaLink, timestamp, videoFileName, camera.name, category);
                logger.info('Mega upload event saved to MongoDB');
                await notifyPushSubscribers({ description, megaLink, timestamp });
            } catch (error) {
                logger.error('Failed to save Mega upload event to MongoDB:', error);
            }
        })
        .catch((error) => logger.error('Failed to upload video to Mega:', error));

    const message = await messagePromise;
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