import { createAccountRingManager } from './index.mjs';

test('ownership prevents a second owner from connecting and preserves existing credentials', async () => {
  const saved = jest.fn();
  const ownership = {
    claim: jest.fn().mockRejectedValue(Object.assign(new Error('Already owned'), { status: 409 })),
    getByRingId: jest.fn()
  };
  const api = { getProfile: async () => ({ profile: { id: 123 } }), disconnect: jest.fn() };
  const manager = createAccountRingManager({
    createApi: async () => api, run: jest.fn(), saveToken: saved, ownership, logger: { error: jest.fn() }
  });
  await expect(manager.activate('second@example.com', 'token')).rejects.toMatchObject({ status: 409 });
  expect(saved).not.toHaveBeenCalled();
  expect(api.disconnect).toHaveBeenCalledTimes(1);
});

test('restore saves rotated credentials but refuses connections without ownership', async () => {
  const saved = jest.fn();
  const logger = { error: jest.fn() };
  const api = {
    restClient: { refreshToken: 'rotated' },
    getProfile: async () => ({ profile: { id: 123 } }),
    disconnect: jest.fn()
  };
  const manager = createAccountRingManager({
    createApi: async () => api, run: jest.fn(), saveToken: saved,
    ownership: {
      getMembership: async () => ({ ownerEmail: 'owner@example.com' }),
      getByRingId: async () => null
    }, logger
  });
  await manager.restore([{ email: 'owner@example.com', refreshToken: 'old' }]);
  expect(saved).toHaveBeenCalledWith('rotated', 'owner@example.com');
  expect(manager.get('owner@example.com')).toBeUndefined();
  expect(logger.error).toHaveBeenCalled();
  expect(api.disconnect).toHaveBeenCalled();
});

test('restore does not use a saved token for a member or an unassigned account', async () => {
  const createApi = jest.fn();
  const manager = createAccountRingManager({
    createApi, run: jest.fn(), saveToken: jest.fn(),
    ownership: {
      getMembership: async email => email === 'member@example.com' ? { ownerEmail: 'owner@example.com' } : null
    },
    logger: { error: jest.fn() }
  });
  await manager.restore([
    { email: 'member@example.com', refreshToken: 'member-token' },
    { email: 'unassigned@example.com', refreshToken: 'unassigned-token' }
  ]);
  expect(createApi).not.toHaveBeenCalled();
});

test('restore saves a rotated token even if the subsequent profile lookup fails', async () => {
  const saved = jest.fn();
  const logger = { error: jest.fn() };
  const manager = createAccountRingManager({
    createApi: async () => ({
      restClient: { refreshToken: 'rotated' },
      getProfile: async () => { throw new Error('profile unavailable'); },
      disconnect: jest.fn()
    }),
    run: jest.fn(), saveToken: saved, logger,
    ownership: { getMembership: async () => ({ ownerEmail: 'owner@example.com' }) }
  });
  await manager.restore([{ email: 'owner@example.com', refreshToken: 'old' }]);
  expect(saved).toHaveBeenCalledWith('rotated', 'owner@example.com');
  expect(logger.error).toHaveBeenCalled();
});

test('owner listener resolves current membership and stops delivering on release', async () => {
  let membership = { ownerEmail: 'owner@example.com', participants: ['member@example.com', 'owner@example.com'] };
  let recipients;
  const manager = createAccountRingManager({
    createApi: async () => ({ getProfile: async () => ({ profile: { id: 123 } }), disconnect: jest.fn() }),
    run: async (_api, _id, lookup) => { recipients = lookup; return jest.fn(); },
    ownership: { claim: async () => {}, getByRingId: async () => membership },
    logger: { error: jest.fn() }
  });
  await manager.activate('owner@example.com', 'token');
  expect(await recipients()).toEqual(['owner@example.com', 'member@example.com']);
  membership = { ...membership, releasing: true };
  expect(await recipients()).toEqual([]);
  await manager.deactivate('owner@example.com');
  expect(await recipients()).toEqual([]);
});

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
  expect(slowCleanup).not.toHaveBeenCalled();
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
    const listeners = [];
    const run = jest.fn(async (api, id, recipients) => {
      listeners.push({ api, id, recipients, cleanup: jest.fn() });
      return listeners.at(-1).cleanup;
    });
    const manager = createAccountRingManager({
      createApi: async () => ({ getProfile: async () => ({ profile: { id: 123 } }), disconnect: jest.fn() }),
      run,
      logger: { error: jest.fn() }
    });

    await manager.restore([{ email: 'first@example.com', refreshToken: 'one' }, { email: 'second@example.com', refreshToken: 'two' }]);
    expect(manager.getRingAccountId('first@example.com')).toBe('123');
    expect(manager.getRingAccountId('second@example.com')).toBe('123');
    expect(run).toHaveBeenCalledTimes(1);
    expect(manager.get('first@example.com')).toBe(manager.get('second@example.com'));
    expect((await listeners[0].recipients()).sort()).toEqual(['first@example.com', 'second@example.com']);
});

test('moving the listener owner to a different Ring account transfers the shared listener', async () => {
    const listeners = [];
    const manager = createAccountRingManager({
      createApi: async token => ({
        token, getProfile: async () => ({ profile: { id: token === 'different' ? 456 : 123 } }), disconnect: jest.fn()
      }),
      run: async (api, id, recipients) => {
        const listener = { api, id, recipients, cleanup: jest.fn() };
        listeners.push(listener);
        return listener.cleanup;
      },
      logger: { error: jest.fn() }
    });
    await manager.activate('first@example.com', 'first');
    await manager.activate('second@example.com', 'second');
    const firstApi = manager.get('first@example.com');
    await manager.activate('first@example.com', 'different');
    expect(listeners).toHaveLength(3);
    expect(listeners[0].cleanup).toHaveBeenCalledTimes(1);
    expect(await listeners[0].recipients()).toEqual([]);
    expect(await listeners[1].recipients()).toEqual(['first@example.com']);
    expect(await listeners[2].recipients()).toEqual(['second@example.com']);
    expect(manager.get('second@example.com').token).toBe('second');
    expect(manager.get('first@example.com').token).toBe('different');
    expect(firstApi.disconnect).toHaveBeenCalledTimes(1);
});

test('reconnecting a non-owner keeps the shared listener and changing profiles updates its recipients', async () => {
    const listeners = [];
    const manager = createAccountRingManager({
      createApi: async token => ({
        token, getProfile: async () => ({ profile: { id: token === 'different' ? 456 : 123 } }), disconnect: jest.fn()
      }),
      run: async (api, id, recipients) => {
        const listener = { api, id, recipients, cleanup: jest.fn() };
        listeners.push(listener);
        return listener.cleanup;
      },
      logger: { error: jest.fn() }
    });
    await manager.activate('first@example.com', 'first');
    await manager.activate('second@example.com', 'second');
    await manager.activate('second@example.com', 'replacement');
    expect(listeners).toHaveLength(1);
    expect(manager.get('second@example.com')).toBe(manager.get('first@example.com'));
    await manager.activate('second@example.com', 'different');
    expect(listeners).toHaveLength(2);
    expect(await listeners[0].recipients()).toEqual(['first@example.com']);
    expect(await listeners[1].recipients()).toEqual(['second@example.com']);
});

test('failed listener setup preserves the existing connection and recipients', async () => {
    const listeners = [];
    const manager = createAccountRingManager({
      createApi: async token => ({
        token, getProfile: async () => ({ profile: { id: token === 'different' ? 456 : 123 } }), disconnect: jest.fn()
      }),
      run: async (api, id, recipients) => {
        if (id === '456') throw new Error('listener unavailable');
        const listener = { api, recipients, cleanup: jest.fn() };
        listeners.push(listener);
        return listener.cleanup;
      },
      logger: { error: jest.fn() }
    });
    await manager.activate('first@example.com', 'first');
    await expect(manager.activate('first@example.com', 'different')).rejects.toThrow('listener unavailable');
    expect(manager.get('first@example.com').token).toBe('first');
    expect(listeners[0].cleanup).not.toHaveBeenCalled();
    expect(await listeners[0].recipients()).toEqual(['first@example.com']);
});

test('superseded listener setup is discarded before a newer connection is activated', async () => {
    let finishSetup;
    let setupStarted;
    const started = new Promise(resolve => { setupStarted = resolve; });
    const cleanup = jest.fn();
    const manager = createAccountRingManager({
      createApi: async token => ({
        token, getProfile: async () => ({ profile: { id: token === 'slow' ? 123 : 456 } }), disconnect: jest.fn()
      }),
      run: async api => {
        if (api.token === 'slow') {
          setupStarted();
          await new Promise(resolve => { finishSetup = resolve; });
          return cleanup;
        }
        return jest.fn();
      },
      logger: { error: jest.fn() }
    });
    const slow = manager.activate('user@example.com', 'slow');
    await started;
    const fast = manager.activate('user@example.com', 'fast');
    finishSetup();
    await Promise.all([slow, fast]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.getRingAccountId('user@example.com')).toBe('456');
    expect(manager.get('user@example.com').token).toBe('fast');
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
