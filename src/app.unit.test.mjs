jest.mock('./ringNotificationHandler/index.mjs', () => ({
  handleRingNotification: jest.fn().mockResolvedValue('sent')
}));
jest.mock('./helpers/fileHelper/index.mjs', () => ({ purgeLocalFiles: jest.fn() }));
jest.mock('./helpers/processHelper/index.mjs', () => ({ stopProcessInMs: jest.fn() }));
jest.mock('./helpers/dbHelper/index.mjs', () => ({ claimRingNotification: jest.fn() }));

import { run } from './app.mjs';
import { createAccountRingManager } from './helpers/accountRingHelper/index.mjs';
import { handleRingNotification } from './ringNotificationHandler/index.mjs';
import { claimRingNotification } from './helpers/dbHelper/index.mjs';

beforeEach(() => {
  jest.clearAllMocks();
  claimRingNotification.mockReset().mockResolvedValue(true);
  handleRingNotification.mockReset().mockResolvedValue('sent');
});

test('one owner camera listener routes a Ring notification to accepted members', async () => {
  const apis = [];
  const manager = createAccountRingManager({
    createApi: async token => {
      const callbacks = [];
      const camera = {
        name: 'Door',
        onNewNotification: {
          subscribe: jest.fn(callback => {
            callbacks.push(callback);
            return { unsubscribe: jest.fn() };
          })
        }
      };
      const api = {
        token, camera, callbacks,
        getProfile: async () => ({ profile: { id: 123 } }),
        getCameras: jest.fn(async () => [camera]),
        getLocations: jest.fn(async () => []),
        disconnect: jest.fn()
      };
      apis.push(api);
      return api;
    },
    run,
    ownership: {
      getMembership: async () => ({ ownerEmail: 'one@example.com' }),
      getByRingId: async () => ({
        ownerEmail: 'one@example.com',
        participants: ['one@example.com', 'two@example.com']
      })
    },
    logger: { error: jest.fn() }
  });
  await manager.restore([
    { email: 'one@example.com', refreshToken: 'one' },
    { email: 'two@example.com', refreshToken: 'two' }
  ]);
  const active = manager.get('one@example.com');
  expect(manager.get('two@example.com')).toBeUndefined();
  expect(apis).toHaveLength(1);
  expect(apis.reduce((count, api) => count + api.camera.onNewNotification.subscribe.mock.calls.length, 0)).toBe(1);
  expect(apis.filter(api => api.getCameras.mock.calls.length)).toHaveLength(1);
  const notification = { android_config: { body: 'Motion' }, data: { event: { ding: { id: 'event-1' } } } };
  await active.callbacks[0](notification);
  expect(claimRingNotification).toHaveBeenCalledWith('123', 'event-1');
  expect(handleRingNotification).toHaveBeenCalledTimes(1);
  expect(handleRingNotification).toHaveBeenCalledWith(
    active.camera, notification, expect.arrayContaining(['one@example.com', 'two@example.com']), '123'
  );
  expect(handleRingNotification.mock.calls[0][2]).toHaveLength(2);
});

test('processes a claimed event once, including concurrent deliveries and different categories', async () => {
  let callback;
  const camera = { onNewNotification: { subscribe: handler => {
    callback = handler;
    return { unsubscribe: jest.fn() };
  } } };
  const claimed = new Set();
  claimRingNotification.mockImplementation(async (accountId, eventId) => {
    const key = `${accountId}:${eventId}`;
    if (claimed.has(key)) return false;
    claimed.add(key);
    return true;
  });
  const cleanup = await run({ getCameras: async () => [camera], getLocations: async () => [] }, '123', async () => ['owner@example.com']);
  const notification = (id, category = 'com.ring.pn.live-event.motion') => ({
    android_config: { category }, data: { event: { ding: { id } } }
  });

  await Promise.all([callback(notification('event-1')), callback(notification('event-1'))]);
  await callback(notification('event-1', 'com.ring.pn.live-event.ding'));
  await callback(notification('event-2'));
  await callback(notification(undefined));
  expect(handleRingNotification).toHaveBeenCalledTimes(2);
  expect(claimRingNotification).toHaveBeenCalledTimes(4);
  cleanup();
});

test('does not claim events without recipients and does not retry after processing fails', async () => {
  let callback;
  const camera = { onNewNotification: { subscribe: handler => {
    callback = handler;
    return { unsubscribe: jest.fn() };
  } } };
  const getRecipients = jest.fn().mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce([]).mockResolvedValue(['owner@example.com']);
  const cleanup = await run({ getCameras: async () => [camera], getLocations: async () => [] }, '123', getRecipients);
  const notification = { android_config: { body: 'Motion' }, data: { event: { ding: { id: 'event-1' } } } };
  handleRingNotification.mockRejectedValueOnce(new Error('delivery failed'));
  claimRingNotification.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await callback(notification);
  await callback(notification);
  expect(claimRingNotification).not.toHaveBeenCalled();
  await callback(notification);
  await callback(notification);
  expect(handleRingNotification).toHaveBeenCalledTimes(1);
  cleanup();
});
