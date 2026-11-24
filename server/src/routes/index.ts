import { type FastifyInstance } from 'fastify';
import registerHealth from './health.ts';
import registerAuth from './auth.ts';
import registerTeams from './teams.ts';
import registerEpics from './epics.ts';
import registerTickets from './tickets.ts';

export default async function routes(app: FastifyInstance) {
  await app.register(registerHealth);
  await app.register(registerAuth);
  await app.register(registerTeams);
  await app.register(registerEpics);
  await app.register(registerTickets);
}
