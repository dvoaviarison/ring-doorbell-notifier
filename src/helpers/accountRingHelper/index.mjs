export function createAccountRingManager({ createApi, run, saveToken, logger, ownership }) {
  const accounts = new Map();
  const groups = new Map();
  const activations = new Map();
  const sequences = new Map();
  const tokenWrites = new Map();
  let transition = Promise.resolve();

  function persist(email, token, activation) {
    const previous = tokenWrites.get(email) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      if (activations.get(email) === activation) await saveToken(token, email);
    });
    tokenWrites.set(email, write);
    return write;
  }

  function serialize(operation) {
    const result = transition.then(operation, operation);
    transition = result.then(() => undefined, () => undefined);
    return result;
  }

  async function prepareListener(api, ownerEmail, ringAccountId) {
    const listener = { api, ownerEmail, cleanup: undefined };
    const recipients = async () => {
      if (groups.get(ringAccountId)?.listener !== listener) return [];
      if (ownership) {
        const group = await ownership.getByRingId(ringAccountId);
        if (groups.get(ringAccountId)?.listener !== listener || group?.ownerEmail !== ownerEmail || group.releasing) return [];
        return [ownerEmail, ...group.participants.filter(email => email !== ownerEmail)];
      }
      return [...accounts.entries()]
        .filter(([, account]) => account.ringAccountId === ringAccountId)
        .map(([email]) => email);
    };
    listener.cleanup = await run(api, ringAccountId, recipients);
    return listener;
  }

  async function activate(email, refreshToken, { restore = false } = {}) {
    const activation = (sequences.get(email) ?? 0) + 1;
    sequences.set(email, activation);
    activations.set(email, activation);
    let api;
    let committed = false;
    try {
      api = await createApi(refreshToken);
      let profile;
      try {
        profile = await api.getProfile();
      } finally {
        if (restore && saveToken) await persist(email, api.restClient?.refreshToken ?? refreshToken, activation);
      }
      const id = profile?.profile?.id;
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Ring did not return a valid account ID.');
      const ringAccountId = String(id);
      await serialize(async () => {
        if (activations.get(email) !== activation) return;
        if (ownership) {
          if (restore) {
            const existing = await ownership.getByRingId(ringAccountId);
            if (!existing || existing.ownerEmail !== email || existing.releasing) {
              throw new Error('Saved Ring connection has no matching ownership record.');
            }
          } else {
            await ownership.claim(email, ringAccountId);
          }
        }
        if (saveToken) await persist(email, api.restClient?.refreshToken ?? refreshToken, activation);
        if (activations.get(email) !== activation) return;
        const previous = accounts.get(email);
        const oldGroup = previous && groups.get(previous.ringAccountId);
        const targetGroup = groups.get(ringAccountId);
        const prepared = [];
        try {
          let targetListener;
          if (!targetGroup || (previous?.ringAccountId === ringAccountId && targetGroup.listener.ownerEmail === email)) {
            targetListener = await prepareListener(api, email, ringAccountId);
            prepared.push(targetListener);
          }
          let oldReplacement;
          if (previous && previous.ringAccountId !== ringAccountId && oldGroup?.listener.ownerEmail === email) {
            const replacement = [...accounts.entries()].find(([otherEmail, account]) =>
              otherEmail !== email && account.ringAccountId === previous.ringAccountId);
            if (replacement) {
              oldReplacement = await prepareListener(replacement[1].api, replacement[0], previous.ringAccountId);
              prepared.push(oldReplacement);
            }
          }
          if (activations.get(email) !== activation) {
            prepared.forEach(listener => listener.cleanup());
            return;
          }
          if (saveToken) await persist(email, api.restClient?.refreshToken ?? refreshToken, activation);
          if (activations.get(email) !== activation) {
            prepared.forEach(listener => listener.cleanup());
            return;
          }
          const tokenSubscription = api.onRefreshTokenUpdated?.subscribe(({ newRefreshToken }) => {
            if (!newRefreshToken || !saveToken) return;
            void persist(email, newRefreshToken, activation).catch(error => {
              logger.error('Could not persist the updated Ring refresh token:', error);
            });
          });
          accounts.set(email, { api, ringAccountId, activation, tokenSubscription });
          if (oldGroup && previous.ringAccountId !== ringAccountId && oldGroup.listener.ownerEmail === email) {
            if (oldReplacement) groups.set(previous.ringAccountId, { listener: oldReplacement });
            else groups.delete(previous.ringAccountId);
            oldGroup.listener.cleanup();
          }
          if (targetListener) {
            groups.set(ringAccountId, { listener: targetListener });
            targetGroup?.listener.cleanup();
          }
          committed = true;
          previous?.tokenSubscription?.unsubscribe();
          previous?.api.disconnect();
        } catch (error) {
          prepared.forEach(listener => listener.cleanup());
          throw error;
        }
      });
    } catch (error) {
      if (activations.get(email) === activation) {
        const previous = accounts.get(email);
        if (previous) {
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
      }
      throw error;
    } finally {
      if (!committed) api?.disconnect();
    }
  }

  async function restore(entries) {
    await Promise.all(entries.map(async ({ email, refreshToken }) => {
      try {
        if (ownership) {
          const membership = await ownership.getMembership(email);
          if (!membership || membership.ownerEmail !== email || membership.releasing) {
            throw new Error('Saved Ring connection has no active ownership record.');
          }
        }
        await activate(email, refreshToken, { restore: true });
      } catch (error) {
        logger.error(`Could not restore a Ring connection for ${email}:`, error);
      }
    }));
  }

  return {
    activate, restore,
    deactivate: async email => {
      activations.set(email, (sequences.get(email) ?? 0) + 1);
      sequences.set(email, activations.get(email));
      await serialize(async () => {
        const account = accounts.get(email);
        if (!account) return;
        const group = groups.get(account.ringAccountId);
        accounts.delete(email);
        if (group?.listener.ownerEmail === email) {
          groups.delete(account.ringAccountId);
          group.listener.cleanup();
        }
        account.tokenSubscription?.unsubscribe();
        account.api.disconnect();
      });
      try {
        await tokenWrites.get(email);
      } catch (error) {
        logger.error('Could not persist a Ring refresh token before disconnection:', error);
      }
    },
    get: email => {
      const account = accounts.get(email);
      return account && groups.get(account.ringAccountId)?.listener.api;
    },
    getRingAccountId: email => accounts.get(email)?.ringAccountId
  };
}
