import { createAccountRingManager } from './index.mjs';

test('Ring connections are isolated and reconnect only replaces the matching account', async () => {
  const apis = [];
  const cleanups = [];
  const manager = createAccountRingManager({
    createApi: async token => {
      const api = { token, getProfile: async () => ({ profile: { id: token === 'second' ? 456 : 123 } }), disconnect: jest.fn() };
      apis.push(api);
      return api;
    },
    run: async (_api, email) => {
      const cleanup = jest.fn();
      cleanups.push({ email, cleanup });
      return cleanup;
    },
    logger: { error: jest.fn() }
  });
  await manager.restore([
    { email: 'first@example.com', refreshToken: 'first' },
    { email: 'second@example.com', refreshToken: 'second' }
  ]);
  await manager.activate('first@example.com', 'replacement');
  expect(manager.get('first@example.com').token).toBe('replacement');
  expect(manager.get('second@example.com').token).toBe('second');
  expect(manager.getRingAccountId('first@example.com')).toBe('123');
  expect(manager.getRingAccountId('second@example.com')).toBe('456');
  expect(manager.get('third@example.com')).toBeUndefined();
  expect(apis[0].disconnect).toHaveBeenCalledTimes(1);
  expect(apis[1].disconnect).not.toHaveBeenCalled();
  expect(cleanups[0].cleanup).toHaveBeenCalledTimes(1);
  expect(cleanups[1].cleanup).not.toHaveBeenCalled();
});

test('a slower connection cannot replace a newer login for the same account', async () => {
  let finishFirst;
  const slowApi = { getProfile: async () => ({ profile: { id: 123 } }), disconnect: jest.fn() };
  const fastApi = { getProfile: async () => ({ profile: { id: 123 } }), disconnect: jest.fn() };
  const slowCleanup = jest.fn();
  const manager = createAccountRingManager({
    createApi: token => token === 'slow'
      ? new Promise(resolve => { finishFirst = () => resolve(slowApi); })
      : Promise.resolve(fastApi),
    run: async api => api === slowApi ? slowCleanup : jest.fn(),
    logger: { error: jest.fn() }
  });

  const slow = manager.activate('first@example.com', 'slow');
  await manager.activate('first@example.com', 'fast');
  finishFirst();
  await slow;
  expect(manager.get('first@example.com')).toBe(fastApi);
  expect(slowCleanup).toHaveBeenCalledTimes(1);
  expect(slowApi.disconnect).toHaveBeenCalledTimes(1);
});

test('restoring and reconnecting use the verified Ring profile', async () => {
    const manager = createAccountRingManager({
      createApi: async token => ({ getProfile: async () => ({ profile: { id: token === 'old' ? 123 : 456 } }), disconnect: jest.fn() }),
      run: async () => jest.fn(),
      saveToken: jest.fn(),
      logger: { error: jest.fn() }
    });
    await manager.restore([{ email: 'user@example.com', refreshToken: 'old' }]);
    expect(manager.getRingAccountId('user@example.com')).toBe('123');
    await manager.activate('user@example.com', 'new');
    expect(manager.getRingAccountId('user@example.com')).toBe('456');
});

test('two Google users linked to the same Ring profile receive the same account ID', async () => {
    const manager = createAccountRingManager({
      createApi: async () => ({ getProfile: async () => ({ profile: { id: 123 } }), disconnect: jest.fn() }),
      run: async () => jest.fn(),
      logger: { error: jest.fn() }
    });

    await manager.restore([{ email: 'first@example.com', refreshToken: 'one' }, { email: 'second@example.com', refreshToken: 'two' }]);
    expect(manager.getRingAccountId('first@example.com')).toBe('123');
    expect(manager.getRingAccountId('second@example.com')).toBe('123');
});

test('a failed reconnect keeps the old connection and its refreshed token', async () => {
      const saveToken = jest.fn();
      const old = {
        restClient: { refreshToken: 'rotated-old' },
        getProfile: async () => ({ profile: { id: 123 } }),
        disconnect: jest.fn()
      };
      const manager = createAccountRingManager({
        createApi: async token => token === 'old' ? old : {
          getProfile: async () => { throw new Error('Ring unavailable'); }, disconnect: jest.fn()
        },
        run: async () => jest.fn(),
        saveToken,
        logger: { error: jest.fn() }
      });

      await manager.restore([{ email: 'user@example.com', refreshToken: 'old' }]);
      await expect(manager.activate('user@example.com', 'new')).rejects.toThrow('Ring unavailable');
      expect(manager.getRingAccountId('user@example.com')).toBe('123');
      expect(saveToken).toHaveBeenLastCalledWith('rotated-old', 'user@example.com');
      expect(old.disconnect).not.toHaveBeenCalled();
});

test('does not activate when Ring profile has no verified ID', async () => {
        const api = { getProfile: async () => ({ profile: { id: null } }), disconnect: jest.fn() };
        const run = jest.fn();
        const logger = { error: jest.fn() };
        const manager = createAccountRingManager({ createApi: async () => api, run, logger });
        await manager.restore([{ email: 'user@example.com', refreshToken: 'token' }]);
        expect(run).not.toHaveBeenCalled();
        expect(manager.getRingAccountId('user@example.com')).toBeUndefined();
        expect(api.disconnect).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
});
