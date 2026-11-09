jest.mock('./ringNotificationHandler/index.mjs', () => ({
  handleRingNotification: jest.fn().mockResolvedValue('sent')
}));
jest.mock('./helpers/fileHelper/index.mjs', () => ({ purgeLocalFiles: jest.fn() }));
jest.mock('./helpers/processHelper/index.mjs', () => ({ stopProcessInMs: jest.fn() }));

import { run } from './app.mjs';
import { createAccountRingManager } from './helpers/accountRingHelper/index.mjs';
import { handleRingNotification } from './ringNotificationHandler/index.mjs';

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
  const notification = { android_config: { body: 'Motion' } };
  await active.callbacks[0](notification);
  expect(handleRingNotification).toHaveBeenCalledTimes(1);
  expect(handleRingNotification).toHaveBeenCalledWith(
    active.camera, notification, expect.arrayContaining(['one@example.com', 'two@example.com']), '123'
  );
  expect(handleRingNotification.mock.calls[0][2]).toHaveLength(2);
});
