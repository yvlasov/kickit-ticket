import { hash, verify, Algorithm } from '@node-rs/argon2';
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNull } from 'drizzle-orm';
import { Pool } from 'pg';
import { users, verificationTokens } from '../db/schema.ts';
import { sendVerificationEmail } from './mailer.ts';

const HASH_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
  algorithm: Algorithm.Argon2id,
  saltLen: 16,
};

function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password, HASH_OPTIONS);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface AuthResult {
  userId: string;
  rawToken: string;
}

export async function signup(
  db: ReturnType<typeof drizzle>,
  pool: Pool,
  email: string,
  password: string,
): Promise<AuthResult> {
  const trimmedEmail = email.trim();
  const passwordHash = await hashPassword(password);

  const { newUser, rawToken } = await db.transaction(async (tx) => {
    const userRow = await tx
      .insert(users)
      .values({
        email: trimmedEmail,
        passwordHash,
      })
      .returning({ id: users.id })
      .then((rows) => rows[0]);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Delete prior unused tokens for this user
    await tx
      .delete(verificationTokens)
      .where(and(eq(verificationTokens.userId, userRow.id), isNull(verificationTokens.usedAt)));

    await tx.insert(verificationTokens).values({
      userId: userRow.id,
      tokenHash,
      expiresAt,
    });

    return { newUser: userRow, rawToken: token };
  });

  // Send email AFTER transaction commit
  await sendVerificationEmail(trimmedEmail, rawToken);

  return { userId: newUser.id, rawToken };
}

export type VerifyResult = 'success' | 'expired' | 'invalid' | 'used';

export async function verifyToken(
  db: ReturnType<typeof drizzle>,
  token: string,
): Promise<VerifyResult> {
  const tokenHash = hashToken(token);

  const found = await db
    .select()
    .from(verificationTokens)
    .where(eq(verificationTokens.tokenHash, tokenHash))
    .limit(1)
    .then((rows) => rows[0]);

  if (!found) {
    return 'invalid';
  }

  if (found.usedAt !== null) {
    return 'used';
  }

  if (found.expiresAt < new Date()) {
    return 'expired';
  }

  // Mark as used and verify the user's email
  const now = new Date();
  await db
    .update(verificationTokens)
    .set({ usedAt: now })
    .where(eq(verificationTokens.id, found.id));

  await db
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(eq(users.id, found.userId));

  return 'success';
}

export async function resendVerification(
  db: ReturnType<typeof drizzle>,
  email: string,
): Promise<void> {
  const trimmedEmail = email.trim().toLowerCase();

  const userRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, trimmedEmail))
    .limit(1)
    .then((rows) => rows[0]);

  if (!userRow || userRow.id === null) {
    return;
  }

  const userId = userRow.id;

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Delete prior unused tokens only
  await db
    .delete(verificationTokens)
    .where(and(eq(verificationTokens.userId, userId), isNull(verificationTokens.usedAt)));

  await db.insert(verificationTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });

  const emailRow = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((rows) => rows[0]);

  if (emailRow?.email) {
    await sendVerificationEmail(emailRow.email, rawToken);
  }
}

export { verifyPassword };
