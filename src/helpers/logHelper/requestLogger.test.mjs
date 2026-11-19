import { EventEmitter } from 'node:events';
import express from 'express';
import { createRequestLogger } from './requestLogger.mjs';

test('logs requests and error statuses without query, body, or path parameter values', async () => {
  const logger = { info: jest.fn(), error: jest.fn() };
  const app = express();
  app.use(createRequestLogger(logger, ['/events/{id}/video', '/settings/mega', '/blocked']));
  app.use(express.json());
  app.get('/events/:id/video', (_req, res) => res.sendStatus(200));
  app.post('/settings/mega', (_req, res) => res.sendStatus(500));
  app.get('/blocked', (_req, res) => res.sendStatus(401));
  app.use((error, _req, res, _next) => res.status(400).send('Invalid JSON'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  try {
    expect((await fetch(`${url}/events/private-id/video?token=private-token`)).status).toBe(200);
    expect((await fetch(`${url}/settings/mega`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'private-password' })
    })).status).toBe(500);
    expect((await fetch(`${url}/settings/mega`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
    })).status).toBe(400);
    expect((await fetch(`${url}/blocked`)).status).toBe(401);
    expect((await fetch(`${url}/unknown/private-path`)).status).toBe(404);

    const info = logger.info.mock.calls.flat().join('\n');
    const errors = logger.error.mock.calls.flat().join('\n');
    expect(info).toMatch(/Request 1: GET \/events\/\{id\}\/video received/);
    expect(info).toMatch(/Request 1: GET \/events\/\{id\}\/video responded 200 in \d+ms/);
    expect(errors).toMatch(/POST \/settings\/mega responded 500/);
    expect(errors).toMatch(/POST \/settings\/mega responded 400/);
    expect(errors).toMatch(/GET \/blocked responded 401/);
    expect(errors).toMatch(/GET \(unrecognized route\) responded 404/);
    expect(`${info}\n${errors}`).not.toMatch(/private-id|private-token|private-password|private-path/);
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});

test('logs an interrupted response as an error without reporting success', () => {
  const logger = { info: jest.fn(), error: jest.fn() };
  const response = new EventEmitter();
  response.writableFinished = false;
  const next = jest.fn();
  createRequestLogger(logger, ['/health'])({ method: 'GET', path: '/health' }, response, next);
  response.emit('close');
  expect(next).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/GET \/health closed before response completed/));
  expect(logger.info).toHaveBeenCalledTimes(1);
});
