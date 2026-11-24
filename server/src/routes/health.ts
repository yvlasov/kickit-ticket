import { type FastifyInstance } from 'fastify';

export default async function registerHealth(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/readiness', async (_request, reply) => {
    try {
      await app.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ error: { code: 'UNREACHABLE', message: 'Database not reachable' } });
    }
  });
}
