import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, '../drizzle');

describe('Health & Readiness API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pool: Pool;

  beforeAll(async () => {
    app = await buildApp();
    pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    await app.ready();
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('GET /api/health returns 200 {status: "ok"}', async () => {
    const res = await request(app.server).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/readiness returns 200 when DB is reachable', async () => {
    const res = await request(app.server).get('/api/readiness');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown /api route returns 404 with error envelope', async () => {
    const res = await request(app.server).get('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(res.body.error).toHaveProperty('message', 'Not found');
  });
});
