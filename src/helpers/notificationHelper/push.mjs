import "dotenv/config";
import * as webPush from 'web-push';
import { deletePushSubscription, getPushCategories, getPushSubscriptions } from '../dbHelper/index.mjs';
import { eventCategories } from '../eventCategories/index.mjs';
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

export async function notifyPushSubscribers(event, email) {
    if (typeof email !== 'string' || !email.trim()) {
        throw new TypeError('A Google account email is required to send push notifications.');
    }
    const accountEmail = email.trim().toLowerCase();
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
        const category = eventCategories.has(event.category) ? event.category : 'uncategorized';
        const isDoorbellPress = event.isDoorbellPress === true;
        if (!isDoorbellPress && !(await getPushCategories(accountEmail)).includes(category)) {
            return;
        }
        const subscriptions = await getPushSubscriptions(accountEmail);
        const payload = {
            title: isDoorbellPress ? 'Doorbell pressed' : 'New Ring video',
            body: event.description,
            url: '/',
            tag: `ring-event-${event.timestamp.getTime()}`
        };
        if (!isDoorbellPress && typeof event.id === 'string' && event.id) {
            payload.eventId = event.id;
            payload.eventTimestamp = event.timestamp.toISOString();
            payload.cameraName = event.cameraName;
        }
        if (isDoorbellPress) {
            payload.cameraName = event.cameraName;
            payload.doorbellPress = true;
        }

        await Promise.all(subscriptions.map(async ({ endpoint, subscription }) => {
            try {
                await webPush.sendNotification(subscription, JSON.stringify(payload));
            } catch (error) {
                if (error.statusCode === 404 || error.statusCode === 410) {
                    try {
                        await deletePushSubscription(endpoint, accountEmail);
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
