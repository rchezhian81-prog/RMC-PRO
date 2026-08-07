import { BadRequestException } from '@nestjs/common';

/**
 * Company-logo validation, kept in one place so the rule is identical wherever a
 * logo enters the system. The client MIME is never trusted — the bytes are
 * sniffed — so a renamed executable or a mismatched type is refused, not stored.
 */

/** Max raw (decoded) logo size. A branding logo has no business being larger. */
export const MAX_LOGO_BYTES = 512 * 1024; // 512 KB

export const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
export type LogoMime = (typeof ALLOWED_LOGO_MIMES)[number];

export interface ValidatedLogo {
  mime: LogoMime;
  /** Raw file bytes, base64-encoded — exactly what is stored and later rendered. */
  data: string;
}

function bad(message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

/** Normalise the handful of MIME spellings browsers send to our canonical set. */
function normaliseMime(raw: string): LogoMime {
  const m = (raw || '').trim().toLowerCase();
  if (m === 'image/jpg' || m === 'image/jpeg' || m === 'image/pjpeg') return 'image/jpeg';
  if (m === 'image/png') return 'image/png';
  if (m === 'image/svg+xml' || m === 'image/svg') return 'image/svg+xml';
  return bad('Logo must be a PNG, JPG or SVG image.');
}

/** A data-URL prefix (`data:image/png;base64,`) is stripped if the client left it on. */
function stripDataUrl(data: string): string {
  const s = (data || '').trim();
  const comma = s.startsWith('data:') ? s.indexOf(',') : -1;
  return comma >= 0 ? s.slice(comma + 1) : s;
}

/** Sniff the real type from the leading bytes and confirm it matches the claim. */
function sniff(buf: Buffer): LogoMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // SVG is text: find "<svg" near the start, tolerating a BOM/XML prolog.
  const head = buf.subarray(0, 1024).toString('utf8').toLowerCase();
  if (head.includes('<svg')) return 'image/svg+xml';
  return null;
}

/**
 * Validate an incoming logo. Returns the canonical MIME and the clean base64 to
 * store, or throws a 400 the operator can act on. SVGs carrying scripting are
 * refused outright — a logo has no reason to run code.
 */
export function validateLogo(rawMime: unknown, rawData: unknown): ValidatedLogo {
  const mime = normaliseMime(String(rawMime ?? ''));
  const base64 = stripDataUrl(String(rawData ?? ''));
  if (!base64) bad('No logo file was provided.');

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return bad('The logo file could not be read. Please choose the file again.');
  }
  if (!buf.length) bad('The logo file is empty.');
  if (buf.length > MAX_LOGO_BYTES) {
    bad(`Logo must be ${Math.round(MAX_LOGO_BYTES / 1024)} KB or smaller.`);
  }

  const sniffed = sniff(buf);
  if (!sniffed) bad('That file is not a valid PNG, JPG or SVG image.');
  if (sniffed !== mime) bad('The file type does not match its contents. Please re-upload the logo.');

  if (mime === 'image/svg+xml') {
    const svg = buf.toString('utf8').toLowerCase();
    if (svg.includes('<script') || svg.includes('javascript:') || /\son\w+\s*=/.test(svg)) {
      bad('For safety, SVG logos may not contain scripts. Please upload a plain image.');
    }
  }

  // Re-encode from the sniffed buffer so what we store is exactly the bytes.
  return { mime, data: buf.toString('base64') };
}
