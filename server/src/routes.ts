import { type FastifyInstance } from 'fastify';

export default async function routes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/readiness', async (_request, reply) => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(503).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: url });
      await pool.query('SELECT 1');
      await pool.end();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ error: { code: 'UNREACHABLE', message: 'Database not reachable' } });
    }
  });
}
