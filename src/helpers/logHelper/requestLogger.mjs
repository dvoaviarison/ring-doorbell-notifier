export function createRequestLogger(logger, apiPaths) {
  const paths = apiPaths.map(path => path.split('/'));
  let nextRequestId = 0;

  return (req, res, next) => {
    const requestId = ++nextRequestId;
    const start = Date.now();
    const segments = req.path.split('/');
    const route = paths.find(parts => parts.length === segments.length &&
      parts.every((part, index) => /^\{[^/{}]+\}$/.test(part) || part === segments[index]));
    const routeLabel = route ? route.join('/') : '(unrecognized route)';
    logger.info(`Request ${requestId}: ${req.method} ${routeLabel} received`);

    res.once('finish', () => {
      const log = res.statusCode >= 400 ? logger.error.bind(logger) : logger.info.bind(logger);
      log(`Request ${requestId}: ${req.method} ${routeLabel} responded ${res.statusCode} in ${Date.now() - start}ms`);
    });
    res.once('close', () => {
      if (!res.writableFinished) {
        logger.error(`Request ${requestId}: ${req.method} ${routeLabel} closed before response completed in ${Date.now() - start}ms`);
      }
    });
    next();
  };
}
