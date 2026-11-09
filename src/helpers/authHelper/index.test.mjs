jest.mock('ring-client-api/rest-client', () => ({
    RingRestClient: jest.fn()
}));

jest.mock('../dbHelper/index.mjs', () => ({
    storeRefreshToken: jest.fn()
}));

import crypto from 'node:crypto';
import { RingRestClient } from 'ring-client-api/rest-client';
import { authMiddleware, isSlackRequestValid, resolveSlackAccount, setupAuth } from './index.mjs';

describe('Ring authentication persistence', () => {
    it('validates Slack signatures over the captured raw request body', () => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const rawBody = 'text=hello';
        const signature = 'v0=' + crypto.createHmac('sha256', 'test-secret').update(`v0:${timestamp}:${rawBody}`).digest('hex');
        const req = { rawBody, headers: { 'x-slack-signature': signature, 'x-slack-request-timestamp': timestamp } };
        expect(isSlackRequestValid(req, 'test-secret')).toBe(true);
        expect(isSlackRequestValid(req)).toBe(false);
        req.headers['x-slack-signature'] = 'v0=short';
        expect(isSlackRequestValid(req, 'test-secret')).toBe(false);
        req.headers['x-slack-request-timestamp'] = 'invalid';
        expect(isSlackRequestValid(req, 'test-secret')).toBe(false);
    });
    it('binds a signed Slack command to one account and rejects ambiguous signatures', async () => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const rawBody = 'text=Front+Door';
        const signature = 'v0=' + crypto.createHmac('sha256', 'first-secret').update(`v0:${timestamp}:${rawBody}`).digest('hex');
        const req = { rawBody, headers: { 'x-slack-signature': signature, 'x-slack-request-timestamp': timestamp } };
        const candidates = [
            { email: 'first@example.com', signingSecret: 'first-secret' },
            { email: 'second@example.com', signingSecret: 'second-secret' }
        ];
        const logger = { warn: jest.fn() };
        expect(await resolveSlackAccount(req, async () => candidates, logger)).toBe('first@example.com');
        candidates[1].signingSecret = 'first-secret';
        expect(await resolveSlackAccount(req, async () => candidates, logger)).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledTimes(1);
        req.rawBody = 'text=Other';
        expect(await resolveSlackAccount(req, async () => candidates, logger)).toBeUndefined();
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

    it.each(['/', '/login', '/api-docs', '/api-docs/', '/api-docs/swagger-ui.css', '/auth/ring/login', '/settings/slack', '/push/config', '/push/subscriptions'])(
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

    it('does not use another account or an old browser session as Ring authentication', () => {
        const getHandlers = new Map();
        const app = { get: (path, handler) => getHandlers.set(path, handler), post: jest.fn() };
        setupAuth(app, {}, jest.fn(), email => email === 'first@example.com');
        const json = jest.fn();
        getHandlers.get('/auth/ring/status')(
            { accountEmail: 'second@example.com', session: { ringAuthenticated: true } }, { json }
        );
        expect(json).toHaveBeenCalledWith({ authenticated: false });
        const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        authMiddleware(
            { path: '/events', accountEmail: 'second@example.com', session: { ringAuthenticated: true }, headers: {} },
            response, jest.fn(), email => email === 'first@example.com'
        );
        expect(response.status).toHaveBeenCalledWith(401);
    });

    it('does not allow a different Google account to complete a pending Ring login', async () => {
        const client = {
            using2fa: true,
            promptFor2fa: 'Enter code',
            getAuth: jest.fn().mockRejectedValue(new Error('MFA required'))
        };
        RingRestClient.mockImplementationOnce(() => client);
        const handlers = new Map();
        setupAuth({ get: jest.fn(), post: (path, handler) => handlers.set(path, handler) }, { warn: jest.fn() }, jest.fn());
        const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await handlers.get('/auth/ring/login')({
            body: { email: 'ring@example.com', password: 'password' },
            accountEmail: 'first@example.com', sessionID: 'test-session', session: {}
        }, response);
        expect(response.json).toHaveBeenCalledWith({ requiresMfa: true, prompt: 'Enter code' });
        await handlers.get('/auth/ring/mfa')({
            body: { code: '123456' }, accountEmail: 'second@example.com', sessionID: 'test-session'
        }, response);
        expect(response.status).toHaveBeenCalledWith(400);
        expect(client.getAuth).toHaveBeenCalledTimes(1);
    });
});
