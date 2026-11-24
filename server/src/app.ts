import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === 'production' });

  app.register(cookie);

  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const distDir = join(__dirname, '../../web/dist');

  app.register(staticPlugin, {
    root: distDir,
    prefix: '/',
  });

  // Shared pool + drizzle instance
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set');
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  app.decorate('db', db);
  app.decorate('pool', pool);

  app.addHook('onClose', async () => {
    await pool.end();
  });

  const sessionModule = await import('./plugins/session.ts');
  await app.register(sessionModule.sessionGuardPlugin);

  const routesModule = await import('./routes.ts');
  await app.register(routesModule.default, { prefix: '/api' });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}
