import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import { join } from 'path';
import { fileURLToPath } from 'url';

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV === 'production' });

  app.register(cookie);

  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const distDir = join(__dirname, '../../web/dist');

  app.register(staticPlugin, {
    root: distDir,
    prefix: '/',
  });

  app.register(import('./routes'), { prefix: '/api' });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}
