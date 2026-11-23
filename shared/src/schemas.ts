import { z } from 'zod';

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

export type SignupInput = z.infer<typeof signupSchema>;
export type VerifyInput = z.infer<typeof verifySchema>;
export type ResendInput = z.infer<typeof resendSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type RenameTeamInput = z.infer<typeof renameTeamSchema>;
