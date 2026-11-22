import { AsyncLocalStorage } from 'async_hooks';

// This will store context for each request, allowing us to access request-specific data like the user's name in the logger.
export const asyncLocalStorage = new AsyncLocalStorage();

// Middleware to set up async local storage for request-scoped context.
// This makes the user's name available to the logger everywhere.
export function contextMiddleware(req, res, next) {
  const store = {
    user: req.user ? req.user.displayName : 'anonymous',
  };

  asyncLocalStorage.run(store, () => next());
}