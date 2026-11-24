import nodemailer, { type Transporter } from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST ?? 'mailpit';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? '1025');
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_STARTTLS = process.env.SMTP_STARTTLS === 'true';
const SMTP_FROM = process.env.SMTP_FROM ?? 'no-reply@kickit.local';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

export function createTransport(): Transporter {
  const auth: Record<string, string> | undefined = SMTP_USER
    ? { user: SMTP_USER, pass: SMTP_PASS }
    : undefined;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    requireTLS: SMTP_STARTTLS,
    auth,
  });
}

export async function sendVerificationEmail(to: string, rawToken: string): Promise<void> {
  const transport = createTransport();
  const link = `${PUBLIC_BASE_URL}/verify?token=${rawToken}`;

  await transport.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Verify your KickIt email',
    text: `Click this link to verify your email: ${link}`,
    html: `<p>Click this link to verify your email: <a href="${link}">${link}</a></p>`,
  });
}
