import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, '../../drizzle');

export async function runMigrations(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  await pool.end();
}
