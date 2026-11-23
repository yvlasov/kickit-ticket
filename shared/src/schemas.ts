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

export type SignupInput = z.infer<typeof signupSchema>;
export type VerifyInput = z.infer<typeof verifySchema>;
export type ResendInput = z.infer<typeof resendSchema>;
