jest.mock('ring-client-api/rest-client', () => ({
    RingRestClient: jest.fn()
}));

jest.mock('../dbHelper/index.mjs', () => ({
    storeRefreshToken: jest.fn()
}));

import { authMiddleware, setupAuth } from './index.mjs';

describe('Ring authentication persistence', () => {
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
