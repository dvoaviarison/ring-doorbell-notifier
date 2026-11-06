jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn()
}));

jest.mock('../dbHelper/index.mjs', () => ({
    getPushSubscriptions: jest.fn(),
    deletePushSubscription: jest.fn()
}));

import * as webPush from 'web-push';
import { deletePushSubscription, getPushSubscriptions } from '../dbHelper/index.mjs';
import { getPushConfiguration, notifyPushSubscribers } from './index.mjs';

describe('browser push notifications', () => {
    const previousConfig = {
        publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
        privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
        subject: process.env.WEB_PUSH_VAPID_SUBJECT
    };

    beforeEach(() => {
        process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'public-key';
        process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'private-key';
        process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:admin@example.com';
        getPushSubscriptions.mockResolvedValue([]);
        webPush.sendNotification.mockResolvedValue(undefined);
        jest.clearAllMocks();
    });

    afterAll(() => {
        const values = [
            ['WEB_PUSH_VAPID_PUBLIC_KEY', previousConfig.publicKey],
            ['WEB_PUSH_VAPID_PRIVATE_KEY', previousConfig.privateKey],
            ['WEB_PUSH_VAPID_SUBJECT', previousConfig.subject]
        ];
        values.forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    it('reports whether all VAPID configuration is present', () => {
        expect(getPushConfiguration()).toEqual({ configured: true, publicKey: 'public-key' });
        delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
        expect(getPushConfiguration()).toEqual({ configured: false, publicKey: 'public-key' });
    });

    it('sends an event notification to each subscribed browser', async () => {
        getPushSubscriptions.mockResolvedValue([
            {
                endpoint: 'https://fcm.googleapis.com/fcm/send/test',
                subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/test' }
            }
        ]);
        const timestamp = new Date('2026-11-06T12:00:00.000Z');

        await notifyPushSubscribers({ description: 'Motion detected', timestamp });

        expect(webPush.setVapidDetails).toHaveBeenCalledWith(
            'mailto:admin@example.com',
            'public-key',
            'private-key'
        );
        expect(webPush.sendNotification).toHaveBeenCalledWith(
            { endpoint: 'https://fcm.googleapis.com/fcm/send/test' },
            JSON.stringify({
                title: 'New Ring video',
                body: 'Motion detected',
                url: '/',
                tag: `ring-event-${timestamp.getTime()}`
            })
        );
    });

    it('removes expired browser subscriptions', async () => {
        const subscription = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/expired',
            subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/expired' }
        };
        getPushSubscriptions.mockResolvedValue([subscription]);
        webPush.sendNotification.mockRejectedValue({ statusCode: 410 });

        await notifyPushSubscribers({ description: 'Motion detected', timestamp: new Date() });

        expect(deletePushSubscription).toHaveBeenCalledWith(subscription.endpoint);
    });

    it('does not access MongoDB when push configuration is missing', async () => {
        delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;

        await notifyPushSubscribers({ description: 'Motion detected', timestamp: new Date() });

        expect(getPushSubscriptions).not.toHaveBeenCalled();
        expect(webPush.sendNotification).not.toHaveBeenCalled();
    });
});
