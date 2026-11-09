export function createAccountRingManager({ createApi, run, saveToken, logger }) {
  const accounts = new Map();
  const activations = new Map();
  const sequences = new Map();
  const tokenWrites = new Map();

  function persist(email, token, activation) {
    const previous = tokenWrites.get(email) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      if (activations.get(email) === activation) await saveToken(token, email);
    });
    tokenWrites.set(email, write);
    return write;
  }

  async function activate(email, refreshToken) {
    const activation = (sequences.get(email) ?? 0) + 1;
    sequences.set(email, activation);
    const previous = accounts.get(email);
    activations.set(email, activation);
    let api;
    let cleanup;
    try {
      api = await createApi(refreshToken);
      const profile = await api.getProfile();
      const id = profile?.profile?.id;
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Ring did not return a valid account ID.');
      const ringAccountId = String(id);
      if (saveToken) await persist(email, api.restClient?.refreshToken ?? refreshToken, activation);
      cleanup = await run(api, email, ringAccountId);
      if (activation !== activations.get(email)) {
        cleanup();
        api.disconnect();
        return;
      }
      if (saveToken) await persist(email, api.restClient?.refreshToken ?? refreshToken, activation);
      if (activation !== activations.get(email)) {
        cleanup();
        api.disconnect();
        return;
      }

      const tokenSubscription = api.onRefreshTokenUpdated?.subscribe(({ newRefreshToken }) => {
        if (!newRefreshToken || !saveToken) return;
        void persist(email, newRefreshToken, activation).catch(error => {
          logger.error('Could not persist the updated Ring refresh token:', error);
        });
      });
      accounts.set(email, {
        api, ringAccountId, activation,
        cleanup: () => { tokenSubscription?.unsubscribe(); cleanup(); }
      });
      previous?.cleanup();
      previous?.api.disconnect();
    } catch (error) {
      cleanup?.();
      api?.disconnect();
      if (previous && activations.get(email) === activation) {
        activations.set(email, previous.activation);
        const token = previous.api.restClient?.refreshToken;
        if (saveToken && token) {
          try {
            await persist(email, token, previous.activation);
          } catch (saveError) {
            logger.error('Could not persist the previous Ring connection token:', saveError);
          }
        }
      }
      throw error;
    }
  }

  async function restore(entries) {
    await Promise.all(entries.map(async ({ email, refreshToken }) => {
      try {
        await activate(email, refreshToken);
      } catch (error) {
        logger.error(`Could not restore a Ring connection for ${email}:`, error);
      }
    }));
  }

  return {
    activate, restore,
    get: email => accounts.get(email)?.api,
    getRingAccountId: email => accounts.get(email)?.ringAccountId
  };
}
