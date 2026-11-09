import "dotenv/config";
import { WebClient } from '@slack/web-api';
import { logger } from "../logHelper/index.mjs";

const { env } = process;

export async function sendSlackNotificationWithVideo(message, videoFileName, settings) {
    const { botToken, channelId } = settings ?? {};
    if (!botToken || !channelId) return null;
    const slackClient = new WebClient(botToken);
    const filePath = `${env.APP_RECORDING_FOLDER}/${videoFileName}`;
    return slackClient.filesUploadV2({
        channel_id: channelId,
        initial_comment: message,
        file: filePath,
        filename: videoFileName,
    });
}

export async function sendSimpleSlackNotification(message, settings) {
    try {
        const config = settings;
        if (!config?.botToken || !config?.channelId) return null;
        const slackClient = new WebClient(config.botToken);
        logger.info('Sending Slack notification.');
        const res = await slackClient.chat.postMessage({ channel: config.channelId, text: message });
        logger.info(`SlackMessage sent: ${res.ts}`);
        return res;
    } catch (error) {
        logger.error('Error sending Slack notification.');
        throw error;
    }
}
