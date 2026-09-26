import { createHash, randomBytes } from 'node:crypto';

/** How long a reset link works. Short, because the link is a credential. */
export const RESET_TTL_MINUTES = 30;

/** A fresh single-use token and the hash that is stored for it. */
export function newResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashResetToken(token) };
}

/** Only the hash is stored: a database read cannot yield a working link. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A token is 64 hex characters; anything else is refused before the lookup. */
export function looksLikeResetToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
}

/**
 * Where the web app lives, for the link in the email. WEB_ORIGIN when set,
 * else the first browser origin the API already allows (CORS_ORIGINS), else
 * the local dev address.
 */
export function webOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.WEB_ORIGIN ?? '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const first = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).find(Boolean);
  if (first) return first.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

export function resetLink(origin: string, token: string): string {
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

/** The email itself, in plain words. */
export function resetEmail(input: { name: string; link: string; minutes?: number }): { subject: string; text: string; html: string } {
  const minutes = input.minutes ?? RESET_TTL_MINUTES;
  const first = input.name.trim().split(/\s+/)[0] || 'there';
  const subject = 'Reset your Mix Nova password';
  const text = [
    `Hello ${first},`,
    '',
    'Someone asked to reset the password for this Mix Nova login. If that was you, open this link and choose a new password:',
    '',
    input.link,
    '',
    `The link works once and for ${minutes} minutes. If you did not ask for this, ignore this email; your password stays as it is.`,
    '',
    'Mix Nova',
  ].join('\n');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const html = [
    `<p>Hello ${esc(first)},</p>`,
    '<p>Someone asked to reset the password for this Mix Nova login. If that was you, press the button and choose a new password:</p>',
    `<p><a href="${esc(input.link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#6c2bd9;color:#ffffff;text-decoration:none;font-weight:600">Choose a new password</a></p>`,
    `<p style="color:#6b6b7b;font-size:13px">Or copy this address into your browser:<br>${esc(input.link)}</p>`,
    `<p>The link works once and for ${minutes} minutes. If you did not ask for this, ignore this email; your password stays as it is.</p>`,
    '<p>Mix Nova</p>',
  ].join('\n');
  return { subject, text, html };
}
