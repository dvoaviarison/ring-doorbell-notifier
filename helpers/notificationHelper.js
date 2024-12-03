import "dotenv/config";
import axios from 'axios';
import { WebClient } from '@slack/web-api';

const { env } = process;

export async function sendSlackNotificationWithSnapshot(message, snapShotFileName) {
    const filePath = `${env.APP_RECORDING_FOLDER}/${snapShotFileName}`;
    const slackClient = new WebClient(env.SLACK_BOT_TOKEN);
    await slackClient.filesUploadV2({
        channel_id: env.SLACK_CHANNEL_ID,
        initial_comment: message,
        file: filePath,
        filename: snapShotFileName,
    });
}

export function sendSimpleSlackNotification(message) {
    const botToken = env.SLACK_BOT_TOKEN;
    const channelId = env.SLACK_CHANNEL_ID;

    const slackMessage = {
        channel: channelId,
        blocks: [ 
            { 
                type: 'section', 
                text: 
                { 
                    type: 'mrkdwn', 
                    text: message
                }, 
            }
         ],
    };

    axios.post('https://slack.com/api/chat.postMessage', slackMessage, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${botToken}`,
        },
    })
    .then(response => {
        if (response.data.ok) {
            console.log('SlackMessage sent: ', response.data);
        } else {
            console.error('Error sending slack message: ', response.data.error);
        }
    })
    .catch(error => {
        console.error('Error sending slack message: ', error);
    });
}
