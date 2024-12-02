import "dotenv/config";
import axios from 'axios';

const { env } = process;

export function sendMkdSlackNotification(message) {
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
            },
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
