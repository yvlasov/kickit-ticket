import { z } from 'zod';

export const ticketTypeEnum = z.enum(['bug', 'feature', 'fix']);
export const ticketStateEnum = z.enum([
  'new',
  'ready_for_implementation',
  'in_progress',
  'ready_for_acceptance',
  'done',
]);

export const ticketTypeSchema = ticketTypeEnum;
export const ticketStateSchema = ticketStateEnum;
