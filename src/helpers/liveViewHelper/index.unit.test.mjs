import express from 'express';
import { createLiveViewRouter } from './index.mjs';

jest.mock('../ringHelper/index.mjs', () => ({
  findCamera: (locations, name) => locations.flatMap(location => location.cameras)
    .find(camera => camera.name.toLowerCase() === name.toLowerCase()) ?? null,
}));

const sessionId = 'c5e17c90-1010-4b6a-9c2c-dde371083b7d';
let server;
let origin;
let ring;
let session;
let logger;
let camera;

beforeEach(async () => {
  session = {
    start: jest.fn().mockResolvedValue('v=0\r\nanswer'),
    end: jest.fn().mockResolvedValue(undefined),
    activateCameraSpeaker: jest.fn().mockResolvedValue(undefined),
  };
  camera = { name: 'Front', batteryLevel: 73, createSimpleWebRtcSession: () => session, getSnapshot: jest.fn().mockResolvedValue(Buffer.from('jpeg')) };
  ring = { getLocations: jest.fn().mockResolvedValue([{ cameras: [camera] }]) };
  logger = { error: jest.fn() };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.accountEmail = req.get('x-test-user') || 'first@example.com'; next(); });
  app.use('/cameras/live', createLiveViewRouter(() => ring, logger));
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

function post(path, body) {
  return fetch(`${origin}/cameras/live/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('serves battery levels and reports unavailable, invalid, and missing cameras', async () => {
  const url = `${origin}/cameras/live/battery?cameraName=Front`;
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ batteryLevel: 73 });
  camera.batteryLevel = 0;
  expect(await (await fetch(url)).json()).toEqual({ batteryLevel: 0 });
  camera.batteryLevel = null;
  expect(await (await fetch(url)).json()).toEqual({ batteryLevel: null });
  camera.batteryLevel = 101;
  expect((await fetch(url)).status).toBe(502);
  expect(logger.error).toHaveBeenCalled();
  expect((await fetch(`${origin}/cameras/live/battery`)).status).toBe(400);
  expect((await fetch(`${origin}/cameras/live/battery?cameraName=Missing`)).status).toBe(404);
  ring = null;
  expect((await fetch(url)).status).toBe(503);
});

test('serves camera snapshots and reports invalid or unavailable cameras', async () => {
  const response = await fetch(`${origin}/cameras/live/snapshot?cameraName=Front`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^image\/jpeg/);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('jpeg');
  expect((await fetch(`${origin}/cameras/live/snapshot`)).status).toBe(400);
  expect((await fetch(`${origin}/cameras/live/snapshot?cameraName=Missing`)).status).toBe(404);
  camera.getSnapshot.mockRejectedValue(new Error('offline'));
  expect((await fetch(`${origin}/cameras/live/snapshot?cameraName=Front`)).status).toBe(502);
  expect(logger.error).toHaveBeenCalled();
});

test('starts and stops a camera session and rejects duplicate IDs', async () => {
  const offer = { cameraName: 'Front', sdp: 'v=0\r\noffer', sessionId };
  const response = await post('start', offer);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sdp: 'v=0\r\nanswer' });
  expect(session.start).toHaveBeenCalledWith(offer.sdp);
  expect((await post('start', offer)).status).toBe(409);
  expect((await post('stop', { sessionId })).status).toBe(204);
  expect((await post('stop', { sessionId })).status).toBe(204);
  expect(session.end).toHaveBeenCalledTimes(1);
});

test('another account cannot stop a live session', async () => {
  expect((await post('start', { cameraName: 'Front', sdp: 'v=0', sessionId })).status).toBe(200);
  const response = await fetch(`${origin}/cameras/live/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'second@example.com' },
    body: JSON.stringify({ sessionId })
  });

  expect(response.status).toBe(404);
  expect(session.end).not.toHaveBeenCalled();
  expect((await post('stop', { sessionId })).status).toBe(204);
});

test('activates the speaker only for the owner of an existing session', async () => {
  expect((await post('speaker', {})).status).toBe(400);
  expect((await post('speaker', { sessionId })).status).toBe(404);
  expect((await post('start', { cameraName: 'Front', sdp: 'v=0', sessionId })).status).toBe(200);
  const other = await fetch(`${origin}/cameras/live/speaker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'second@example.com' },
    body: JSON.stringify({ sessionId }),
  });
  expect(other.status).toBe(404);
  expect(session.activateCameraSpeaker).not.toHaveBeenCalled();
  expect((await post('speaker', { sessionId })).status).toBe(204);
  expect(session.activateCameraSpeaker).toHaveBeenCalledTimes(1);
  session.activateCameraSpeaker.mockRejectedValue(new Error('Ring unavailable'));
  expect((await post('speaker', { sessionId })).status).toBe(502);
  expect(logger.error).toHaveBeenCalled();
  await post('stop', { sessionId });
});

test('reports when a session ends while activating its speaker', async () => {
  let resolveActivation;
  session.activateCameraSpeaker.mockImplementation(() => new Promise(resolve => { resolveActivation = resolve; }));
  expect((await post('start', { cameraName: 'Front', sdp: 'v=0', sessionId })).status).toBe(200);
  const activating = post('speaker', { sessionId });
  while (!resolveActivation) await new Promise(resolve => setTimeout(resolve, 5));
  expect((await post('stop', { sessionId })).status).toBe(204);
  resolveActivation();
  expect((await activating).status).toBe(410);
});
test('validates input and reports missing cameras and Ring failures', async () => {
  expect((await post('start', {})).status).toBe(400);
  expect((await post('stop', {})).status).toBe(400);
  expect((await post('start', { cameraName: 'Missing', sdp: 'v=0', sessionId })).status).toBe(404);
  session.start.mockRejectedValue(new Error('Ring unavailable'));
  expect((await post('start', { cameraName: 'Front', sdp: 'v=0', sessionId })).status).toBe(502);
  expect(session.end).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalled();
});

test('ends a session stopped while Ring is still starting', async () => {
  let resolveStart;
  session.start.mockImplementation(() => new Promise(resolve => { resolveStart = resolve; }));
  const starting = post('start', { cameraName: 'Front', sdp: 'v=0', sessionId });
  while (!resolveStart) await new Promise(resolve => setTimeout(resolve, 5));
  expect((await post('stop', { sessionId })).status).toBe(204);
  resolveStart('v=0\r\nanswer');
  expect((await starting).status).toBe(410);
  expect(session.end).toHaveBeenCalledTimes(2);
});
