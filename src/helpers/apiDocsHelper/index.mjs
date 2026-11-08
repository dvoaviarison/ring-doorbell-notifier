import swaggerUi from 'swagger-ui-express';

export function setupApiDocs(app, apiSpec) {
  app.get('/', (_req, res) => res.redirect('/api-docs/'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiSpec));
}
