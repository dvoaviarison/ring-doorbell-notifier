import "dotenv/config";
import * as webPush from 'web-push';
import { deletePushSubscription, getPushSubscriptions } from '../dbHelper/index.mjs';
import { logger } from '../logHelper/index.mjs';

const { env } = process;

export function getPushConfiguration() {
    const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY;
    const subject = env.WEB_PUSH_VAPID_SUBJECT;
    return {
        configured: Boolean(publicKey && privateKey && subject),
        publicKey: publicKey || null
    };
}

export async function notifyPushSubscribers(event) {
    const { configured } = getPushConfiguration();
    if (!configured) {
        return;
    }

    try {
        webPush.setVapidDetails(
            env.WEB_PUSH_VAPID_SUBJECT,
            env.WEB_PUSH_VAPID_PUBLIC_KEY,
            env.WEB_PUSH_VAPID_PRIVATE_KEY
        );
        const subscriptions = await getPushSubscriptions();
        const payload = JSON.stringify({
            title: 'New Ring video',
            body: event.description,
            url: '/',
            tag: `ring-event-${event.timestamp.getTime()}`
        });

        await Promise.all(subscriptions.map(async ({ endpoint, subscription }) => {
            try {
                await webPush.sendNotification(subscription, payload);
            } catch (error) {
                if (error.statusCode === 404 || error.statusCode === 410) {
                    try {
                        await deletePushSubscription(endpoint);
                    } catch (deleteError) {
                        logger.error('Failed to remove expired push subscription:', deleteError);
                    }
                    return;
                }
                logger.error('Failed to send browser push notification:', error);
            }
        }));
    } catch (error) {
        logger.error('Could not send browser push notifications:', error);
    }
}
