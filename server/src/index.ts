import { buildApp } from './app';
import { runMigrations } from './db/migrate';

async function main() {
  const app = buildApp();
  await runMigrations(process.env.DATABASE_URL!);
  await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
}
main();
