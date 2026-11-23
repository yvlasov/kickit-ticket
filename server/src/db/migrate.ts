import { Pool } from 'pg';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migrationSql = fs.readFileSync(
  join(__dirname, '../../drizzle/0000_init.sql'),
  'utf8',
);

export async function runMigrations(url: string) {
  const pool = new Pool({ connectionString: url });
  await pool.query(migrationSql);
  await pool.end();
}
