jest.mock('ring-client-api/rest-client', () => ({ RingRestClient: jest.fn() }));
jest.mock('../dbHelper/index.mjs', () => ({ storeRefreshToken: jest.fn() }));

import express from 'express';
import { authMiddleware, setupAuth, setupSession } from '../authHelper/index.mjs';
import { createAccessMiddleware, createGoogleAuth, signPayload } from '../googleAuthHelper/index.mjs';
import { setupApiDocs } from './index.mjs';

describe('Swagger landing page', () => {
    let server;
    let baseUrl;
    const connectedAccounts = new Set();
    const secret = 'test-secret-with-at-least-32-bytes';
    const googleCookie = `a_eye_session=${signPayload({
        sub: 'test-user',
        email: 'allowed@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
    }, secret)}`;
    const previousSessionSecret = process.env.SESSION_SECRET;

    beforeAll(async () => {
        const app = express();
        const googleAuth = createGoogleAuth({
            GOOGLE_CLIENT_ID: 'test-client',
            GOOGLE_CLIENT_SECRET: 'test-secret',
            GOOGLE_ALLOWED_EMAILS: 'allowed@example.com',
            GOOGLE_ALLOWED_ORIGINS: 'http://localhost:3000',
            A_EYE_SESSION_SECRET: secret
        }, { error: jest.fn() });
        process.env.SESSION_SECRET = 'test-ring-session-secret';
        app.use(createAccessMiddleware(googleAuth, () => false));
        setupSession(app);
        app.post('/test-ring-session', (req, res) => {
            connectedAccounts.add(req.accountEmail);
            res.end();
        });
        app.use((req, res, next) => authMiddleware(req, res, next, email => connectedAccounts.has(email)));
        setupApiDocs(app, { openapi: '3.0.3', info: { title: 'Test API', version: '1' }, paths: {} });
        setupAuth(app, {}, jest.fn());
        app.get('/events', (_req, res) => res.json([]));
        await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = previousSessionSecret;
    });

    it('requires Google authentication for the landing page and Swagger assets', async () => {
        for (const path of ['/', '/api-docs/', '/api-docs/swagger-ui.css']) {
            expect((await fetch(`${baseUrl}${path}`)).status).toBe(401);
        }
    });

    it('opens Swagger and its assets without an active Ring connection after Google authentication', async () => {
        const headers = { cookie: googleCookie };
        const landing = await fetch(`${baseUrl}/`, { headers, redirect: 'manual' });
        expect(landing.status).toBe(302);
        expect(landing.headers.get('location')).toBe('/api-docs/');
        const docs = await fetch(`${baseUrl}/api-docs/`, { headers });
        expect(docs.status).toBe(200);
        expect(await docs.text()).toContain('swagger-ui');
        expect((await fetch(`${baseUrl}/api-docs/swagger-ui.css`, { headers })).status).toBe(200);
        expect((await fetch(`${baseUrl}/events`, { headers })).status).toBe(401);
    });

    it('requires valid Google and Ring sessions for operational calls', async () => {
        const forgedCookie = `a_eye_session=${signPayload({
            sub: 'test-user', email: 'allowed@example.com', exp: Math.floor(Date.now() / 1000) + 3600
        }, 'wrong-secret')}`;
        expect((await fetch(`${baseUrl}/events`, { headers: { cookie: forgedCookie } })).status).toBe(401);
        const response = await fetch(`${baseUrl}/test-ring-session`, {
            method: 'POST', headers: { cookie: googleCookie }
        });
        expect(response.status).toBe(200);
        expect((await fetch(`${baseUrl}/events`)).status).toBe(401);
        const authorized = await fetch(`${baseUrl}/events`, {
            headers: { cookie: googleCookie }
        });
        expect(authorized.status).toBe(200);
        expect(await authorized.json()).toEqual([]);
    });
});
