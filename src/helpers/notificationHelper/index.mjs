import "dotenv/config";
import { WebClient } from '@slack/web-api';
import { logger } from "../logHelper/index.mjs";

const { env } = process;

export async function sendSlackNotificationWithSnapshot(message, snapShotFileName) {
    const slackClient = new WebClient(env.SLACK_BOT_TOKEN);
    const filePath = `${env.APP_RECORDING_FOLDER}/${snapShotFileName}`;
    const res = await slackClient.filesUploadV2({
        channel_id: env.SLACK_CHANNEL_ID,
        initial_comment: message,
        file: filePath,
        filename: snapShotFileName,
    });
    return res;
}

export async function sendSimpleSlackNotification(message, channel = env.SLACK_CHANNEL_ID) {
    try {
        const slackClient = new WebClient(env.SLACK_BOT_TOKEN);
        logger.info(`Sending SlackMessage to: ${channel}`);
        const res = await slackClient.chat.postMessage({ channel: channel, text: message });
        logger.info(`SlackMessage sent: ${res.ts}`);
    } catch (error) {
        logger.error('Error sending slack message: ', error);
    }
}
