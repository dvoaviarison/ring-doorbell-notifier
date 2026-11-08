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
            { path: '/capture', session: undefined, headers: {} },
            response,
            next,
            () => true
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(response.redirect).not.toHaveBeenCalled();
    });

    it.each(['/', '/login', '/api-docs', '/api-docs/', '/api-docs/swagger-ui.css', '/auth/ring/login'])(
        'allows %s without a Ring connection', (path) => {
        const next = jest.fn();

        authMiddleware(
            { path, session: undefined, headers: {} },
            { redirect: jest.fn() },
            next,
            () => false
        );

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns an authentication error for protected requests without an active token', () => {
        const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        authMiddleware(
            { path: '/capture', session: undefined, headers: {} },
            response,
            jest.fn(),
            () => false
        );

        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith({
            error: 'Ring is not connected. Sign in through A-Eye or the Ring authentication API.'
        });
    });

    it('protects the video event feed when there is no active Ring session', () => {
        const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        authMiddleware(
            { path: '/events', session: undefined, headers: {} },
            response,
            jest.fn(),
            () => false
        );

        expect(response.status).toHaveBeenCalledWith(401);
    });

    it('redirects the old login path to Swagger', () => {
        const handlers = new Map();
        setupAuth({ get: (path, handler) => handlers.set(path, handler), post: jest.fn() }, {}, jest.fn());
        const response = { redirect: jest.fn() };
        handlers.get('/login')({}, response);
        expect(response.redirect).toHaveBeenCalledWith('/api-docs/');
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
