import "dotenv/config";
import { createHash, randomUUID } from 'node:crypto';
import { getFormattedDateTime } from '../helpers/dateHelper/index.mjs';
import { sendSlackNotificationWithVideo } from '../helpers/notificationHelper/index.mjs';
import { uploadFileToMega } from '../helpers/uploadHelper/index.mjs';
import { recordVideoFromCamera } from '../helpers/videoHelper/index.mjs';
import { formatMessage, removeSlackChannelPrefix } from '../helpers/messageHelper/index.mjs';
import { getAIPoweredVideoDescription } from '../helpers/aiHelper/index.mjs';
import { purgeLocalFiles } from '../helpers/fileHelper/index.mjs';
import { trackPendingUpload } from '../helpers/pendingUploadHelper/index.mjs';
import { logger } from "../helpers/logHelper/index.mjs";
import { getSlackSettings, storeVideoEvent } from '../helpers/dbHelper/index.mjs';
import { notifyPushSubscribers } from '../helpers/pushNotificationHelper/index.mjs';

const { env } = process;
const recordingDurationSec = 10;

export async function handleRingNotification(camera, notif, email, ringAccountId) {
    if (typeof email !== 'string' || !email.trim()) {
        throw new TypeError('A Google account email is required to handle Ring notifications.');
    }
    const accountEmail = email.trim().toLowerCase();
    let slackSettings = null;
    try {
        slackSettings = await getSlackSettings(accountEmail);
    } catch {
        logger.error('Could not load account Slack settings; recording will continue without Slack.');
    }
    const slackConfigured = Boolean(slackSettings?.botToken && slackSettings?.channelId);
    const accountTag = createHash('sha256').update(accountEmail).digest('hex').slice(0, 12);
    const cameraName = String(camera.name ?? 'camera').replace(/[\\/]/g, '_');
    const videoFileName = `${cameraName}-${accountTag}-${getFormattedDateTime()}-${randomUUID()}.mp4`;

    const releaseSlackFile = trackPendingUpload(`${env.APP_RECORDING_FOLDER}/${videoFileName}`);
    logger.info('Recording video...');
    try {
        await recordVideoFromCamera(camera, videoFileName, recordingDurationSec);
    } catch (error) {
        releaseSlackFile();
        throw error;
    }
    logger.info('Video recorded. Uploading');

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

    let eventSaved = false;
    const eventTask = megaUploadPromise
        .then(async (megaLink) => {
            const timestamp = new Date();
            logger.info('Video uploaded to Mega');
            if (typeof megaLink !== 'string' || !megaLink) {
                logger.error('Mega upload completed without a link; no upload event was saved.');
                return;
            }

            try {
                const { description, category } = await normalizedEventPromise;
                const dingId = notif.data?.event?.ding?.id;
                const ringEventId = typeof dingId === 'string' || typeof dingId === 'number' ? String(dingId) : undefined;
                await storeVideoEvent(description, megaLink, timestamp, videoFileName, camera.name, category, ringAccountId, ringEventId);
                eventSaved = true;
                logger.info('Mega upload event saved to MongoDB');
                await notifyPushSubscribers({ description, megaLink, timestamp }, accountEmail);
            } catch {
                logger.error('Failed to save account Mega upload event to MongoDB.');
            }
        })
        .catch(() => logger.error('Failed to upload video to Mega.'))
        .finally(() => {
            if (!slackConfigured && eventSaved) {
                releaseSlackFile();
                purgeLocalFiles();
            } else if (!slackConfigured) {
                logger.error('Keeping the recording because no Slack delivery or saved video event is available.');
            }
        });
    void eventTask.catch(() => logger.error('Failed to finish account notification processing.'));

    const message = await messagePromise;
    if (!slackConfigured) {
        logger.info('Slack is not configured for this account; keeping recording and continuing without Slack.');
        return message;
    }

    logger.info('Sending Slack notification with video...');
    try {
        await sendSlackNotificationWithVideo(message, videoFileName, slackSettings);
    } catch (error) {
        logger.error('Failed to send video to Slack; keeping the recording for retry.');
        throw error;
    }

    releaseSlackFile();
    purgeLocalFiles();
    logger.info('Video attached to Slack');

    return message;
}