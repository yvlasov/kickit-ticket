import { z } from 'zod';
import { ticketTypeEnum, ticketStateSchema } from './enums.ts';

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
});

export const signupSchema = z.object({
  email: z.string().transform((s) => s.trim()).refine((s) => z.string().email().safeParse(s).success, { message: 'Invalid email' }),
  password: z.string().min(8),
});

export const verifySchema = z.object({
  token: z.string().min(1),
});

export const resendSchema = z.object({
  email: z.string().transform((s) => s.trim()).refine((s) => z.string().email().safeParse(s).success, { message: 'Invalid email' }),
});

export const loginSchema = z.object({
  email: z.string().transform((s) => s.trim()).refine((s) => z.string().email().safeParse(s).success, { message: 'Invalid email' }),
  password: z.string().min(1),
});

export const createTeamSchema = z.object({
  name: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Team name is required' }),
});

export const renameTeamSchema = z.object({
  name: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Team name is required' }),
});

export const createEpicSchema = z.object({
  teamId: z.string().refine((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s), { message: 'Invalid team ID' }),
  title: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Title is required' }),
  description: z.string().transform((s) => {
    const trimmed = s.trim();
    return trimmed.length === 0 ? null : trimmed;
  }).optional().nullable(),
});

export const editEpicSchema = z.object({
  title: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Title is required' }),
  description: z.string().transform((s) => {
    const trimmed = s.trim();
    return trimmed.length === 0 ? null : trimmed;
  }).optional().nullable(),
});

export const createTicketSchema = z.object({
  teamId: z.string().refine((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s), { message: 'Invalid team ID' }),
  type: ticketTypeEnum,
  state: ticketStateSchema.optional(),
  epicId: z.string()
    .refine((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s), { message: 'Invalid epic ID' })
    .optional()
    .nullable(),
  title: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Title is required' }),
  body: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Body is required' }),
});

export const editTicketSchema = z.object({
  type: ticketTypeEnum.optional(),
  teamId: z.string().refine((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s), { message: 'Invalid team ID' }).optional(),
  epicId: z.string()
    .refine((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s), { message: 'Invalid epic ID' })
    .optional()
    .nullable(),
  title: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Title is required' }).optional(),
  body: z.string().transform((s) => s.trim()).refine((s) => s.length >= 1, { message: 'Body is required' }).optional(),
  state: ticketStateSchema.optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type VerifyInput = z.infer<typeof verifySchema>;
export type ResendInput = z.infer<typeof resendSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type RenameTeamInput = z.infer<typeof renameTeamSchema>;
export type CreateEpicInput = z.infer<typeof createEpicSchema>;
export type EditEpicInput = z.infer<typeof editEpicSchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type EditTicketInput = z.infer<typeof editTicketSchema>;
