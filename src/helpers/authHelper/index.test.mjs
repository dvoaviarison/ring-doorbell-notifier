jest.mock('ring-client-api/rest-client', () => ({
    RingRestClient: jest.fn()
}));

jest.mock('../dbHelper/index.mjs', () => ({
    storeRefreshToken: jest.fn()
}));

import crypto from 'node:crypto';
import { authMiddleware, isSlackRequestValid, setupAuth } from './index.mjs';

describe('Ring authentication persistence', () => {
    it('validates Slack signatures over the captured raw request body', () => {
        const previous = process.env.SLACK_SIGNING_SECRET;
        process.env.SLACK_SIGNING_SECRET = 'test-secret';
        try {
            const timestamp = String(Math.floor(Date.now() / 1000));
            const rawBody = 'text=hello';
            const signature = 'v0=' + crypto.createHmac('sha256', 'test-secret').update(`v0:${timestamp}:${rawBody}`).digest('hex');
            const req = { rawBody, headers: { 'x-slack-signature': signature, 'x-slack-request-timestamp': timestamp } };
            expect(isSlackRequestValid(req)).toBe(true);
            req.headers['x-slack-signature'] = 'v0=short';
            expect(isSlackRequestValid(req)).toBe(false);
            req.headers['x-slack-request-timestamp'] = 'invalid';
            expect(isSlackRequestValid(req)).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.SLACK_SIGNING_SECRET;
            else process.env.SLACK_SIGNING_SECRET = previous;
        }
    });
    it('allows requests when the saved Ring token has initialized the API', () => {
        const next = jest.fn();
        const response = { redirect: jest.fn() };

        authMiddleware(
            { path: '/update-user-prompt', session: undefined, headers: {} },
            response,
            next,
            () => true
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(response.redirect).not.toHaveBeenCalled();
    });

    it('keeps the dashboard available so an account can be connected in Settings', () => {
        const next = jest.fn();

        authMiddleware(
            { path: '/', session: undefined, headers: {} },
            { redirect: jest.fn() },
            next,
            () => false
        );

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('sends protected requests to Ring setup when there is no active token', () => {
        const response = { redirect: jest.fn() };

        authMiddleware(
            { path: '/update-user-prompt', session: undefined, headers: {} },
            response,
            jest.fn(),
            () => false
        );

        expect(response.redirect).toHaveBeenCalledWith('/#settings');
    });

    it('protects the video event feed when there is no active Ring session', () => {
        const response = { redirect: jest.fn() };

        authMiddleware(
            { path: '/events', session: undefined, headers: {} },
            response,
            jest.fn(),
            () => false
        );

        expect(response.redirect).toHaveBeenCalledWith('/#settings');
    });

    it('reports the active Ring connection even when the browser has no login session', () => {
        const getHandlers = new Map();
        const app = {
            get: jest.fn((path, handler) => getHandlers.set(path, handler)),
            post: jest.fn()
        };
        setupAuth(app, {}, jest.fn(), () => true);

        const json = jest.fn();
        getHandlers.get('/auth/ring/status')(
            { session: {} },
            { json }
        );

        expect(json).toHaveBeenCalledWith({ authenticated: true });
    });
});
