import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '../drizzle/0000_init.sql'),
  'utf8',
);

describe('Health & Readiness API', () => {
  let app: ReturnType<typeof buildApp>;
  let pool: Pool;

  beforeAll(async () => {
    app = buildApp();
    pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    await pool.query(migrationSql);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('GET /api/health returns 200 {status: "ok"}', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  it('GET /api/readiness returns 200 when DB is reachable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/readiness',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  it('unknown /api route returns 404 with error envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/nope',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(body.error).toHaveProperty('message', 'Not found');
  });
});
