import { BadRequestException } from '@nestjs/common';

/**
 * Upload validation, kept in one place so the rule is identical wherever a
 * file enters the system (the company logo, a user's photo or ID proof). The
 * client MIME is never trusted — the bytes are sniffed — so a renamed
 * executable or a mismatched type is refused, not stored.
 */

/** Max raw (decoded) logo size. A branding logo has no business being larger. */
export const MAX_LOGO_BYTES = 512 * 1024; // 512 KB

export const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
export type LogoMime = (typeof ALLOWED_LOGO_MIMES)[number];

/** Every content type any upload may carry. */
export type UploadMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml' | 'application/pdf';

export interface ValidatedLogo {
  mime: LogoMime;
  /** Raw file bytes, base64-encoded — exactly what is stored and later rendered. */
  data: string;
}

export interface ValidatedUpload {
  mime: UploadMime;
  data: string;
}

export interface UploadRule {
  /** The content types this upload accepts. */
  allowed: readonly UploadMime[];
  /** Max raw (decoded) size in bytes. */
  maxBytes: number;
  /** What the operator called it, for messages: "logo", "photo", "ID proof". */
  what: string;
  /** How the accepted types read in a message, without an article: "PNG, JPG or SVG image". */
  accepts: string;
}

function bad(message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

/** Normalise the handful of MIME spellings browsers send to our canonical set. */
function normaliseMime(raw: string): UploadMime | null {
  const m = (raw || '').trim().toLowerCase();
  if (m === 'image/jpg' || m === 'image/jpeg' || m === 'image/pjpeg') return 'image/jpeg';
  if (m === 'image/png') return 'image/png';
  if (m === 'image/webp') return 'image/webp';
  if (m === 'image/svg+xml' || m === 'image/svg') return 'image/svg+xml';
  if (m === 'application/pdf' || m === 'application/x-pdf') return 'application/pdf';
  return null;
}

/** A data-URL prefix (`data:image/png;base64,`) is stripped if the client left it on. */
function stripDataUrl(data: string): string {
  const s = (data || '').trim();
  const comma = s.startsWith('data:') ? s.indexOf(',') : -1;
  return comma >= 0 ? s.slice(comma + 1) : s;
}

/** Sniff the real type from the leading bytes and confirm it matches the claim. */
export function sniffUpload(buf: Buffer): UploadMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: RIFF....WEBP
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  // SVG is text: find "<svg" near the start, tolerating a BOM/XML prolog.
  const head = buf.subarray(0, 1024).toString('utf8').toLowerCase();
  if (head.includes('<svg')) return 'image/svg+xml';
  return null;
}

/**
 * Validate an incoming file against a rule. Returns the canonical MIME and the
 * clean base64 to store, or throws a 400 the operator can act on. SVGs carrying
 * scripting are refused outright — a stored image has no reason to run code.
 */
export function validateUpload(rawMime: unknown, rawData: unknown, rule: UploadRule): ValidatedUpload {
  const mime = normaliseMime(String(rawMime ?? ''));
  const What = rule.what.charAt(0).toUpperCase() + rule.what.slice(1);
  if (!mime || !rule.allowed.includes(mime)) bad(`${What} must be a ${rule.accepts}.`);
  const base64 = stripDataUrl(String(rawData ?? ''));
  if (!base64) bad(`No ${rule.what} file was provided.`);

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return bad(`The ${rule.what} file could not be read. Please choose the file again.`);
  }
  if (!buf.length) bad(`The ${rule.what} file is empty.`);
  if (buf.length > rule.maxBytes) {
    const kb = rule.maxBytes / 1024;
    bad(`${What} must be ${kb >= 1024 ? `${Math.round(kb / 1024)} MB` : `${Math.round(kb)} KB`} or smaller.`);
  }

  const sniffed = sniffUpload(buf);
  if (!sniffed || !rule.allowed.includes(sniffed)) bad(`That file is not a valid ${rule.accepts}.`);
  if (sniffed !== mime) bad(`The file type does not match its contents. Please choose the ${rule.what} again.`);

  if (mime === 'image/svg+xml') {
    const svg = buf.toString('utf8').toLowerCase();
    if (svg.includes('<script') || svg.includes('javascript:') || /\son\w+\s*=/.test(svg)) {
      bad(`For safety, an SVG ${rule.what} may not contain scripts. Please upload a plain image.`);
    }
  }

  // Re-encode from the sniffed buffer so what we store is exactly the bytes.
  return { mime, data: buf.toString('base64') };
}

const LOGO_RULE: UploadRule = {
  allowed: ALLOWED_LOGO_MIMES,
  maxBytes: MAX_LOGO_BYTES,
  what: 'logo',
  accepts: 'PNG, JPG or SVG image',
};

/** Validate an incoming company logo (PNG / JPG / SVG, 512 KB). */
export function validateLogo(rawMime: unknown, rawData: unknown): ValidatedLogo {
  const v = validateUpload(rawMime, rawData, LOGO_RULE);
  return { mime: v.mime as LogoMime, data: v.data };
}

/** A user's photo: PNG / JPG / WebP, 1 MB. SVG is refused (it can carry markup). */
export const USER_PHOTO_RULE: UploadRule = {
  allowed: ['image/png', 'image/jpeg', 'image/webp'],
  maxBytes: 1024 * 1024,
  what: 'photo',
  accepts: 'PNG, JPG or WebP image',
};

/** A user's ID proof: an image or a PDF scan, 3 MB. */
export const USER_ID_PROOF_RULE: UploadRule = {
  allowed: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
  maxBytes: 3 * 1024 * 1024,
  what: 'ID proof',
  accepts: 'PNG, JPG or WebP image, or PDF',
};
