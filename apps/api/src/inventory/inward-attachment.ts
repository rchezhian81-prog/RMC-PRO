import { BadRequestException } from '@nestjs/common';

/**
 * The supplier's invoice attached to a material inward — a photo from the
 * gate or the PDF the supplier emailed. Validated the way the company logo
 * is (setup/logo.ts): the client's MIME is never trusted, the bytes are
 * sniffed, and a mismatch is refused rather than stored. SVG is not an
 * invoice format and can carry script, so it is refused outright.
 */

/** Max raw (decoded) attachment size. A phone photo of an invoice is well under this. */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 MB

export const ALLOWED_ATTACHMENT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export type AttachmentMime = (typeof ALLOWED_ATTACHMENT_MIMES)[number];

export interface ValidatedAttachment {
  name: string;
  mime: AttachmentMime;
  /** Raw file bytes, base64-encoded — exactly what is stored and later streamed. */
  data: string;
}

function bad(message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

const TYPES_SENTENCE = 'The invoice must be a PNG, JPG or WebP image, or a PDF.';

/** Normalise the handful of MIME spellings browsers send to our canonical set. */
function normaliseMime(raw: string): AttachmentMime {
  const m = (raw || '').trim().toLowerCase();
  if (m === 'image/jpg' || m === 'image/jpeg' || m === 'image/pjpeg') return 'image/jpeg';
  if (m === 'image/png') return 'image/png';
  if (m === 'image/webp') return 'image/webp';
  if (m === 'application/pdf' || m === 'application/x-pdf') return 'application/pdf';
  if (m === 'image/svg+xml' || m === 'image/svg') return bad('SVG files are not accepted as an invoice. ' + TYPES_SENTENCE);
  return bad(TYPES_SENTENCE);
}

/** A data-URL prefix (`data:image/png;base64,`) is stripped if the client left it on. */
function stripDataUrl(data: string): string {
  const s = (data || '').trim();
  const comma = s.startsWith('data:') ? s.indexOf(',') : -1;
  return comma >= 0 ? s.slice(comma + 1) : s;
}

/** Sniff the real type from the leading bytes. */
export function sniffAttachment(buf: Buffer): AttachmentMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // WebP: "RIFF" <size> "WEBP".
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** A file name safe to store and to put in a Content-Disposition header. */
function cleanName(raw: unknown, mime: AttachmentMime): string {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'pdf';
  const base = String(raw ?? '').replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!base) return `invoice.${ext}`;
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${ext}`;
}

/**
 * Validate an incoming attachment. Returns the clean name, the canonical MIME
 * and the base64 to store, or throws a 400 the operator can act on.
 */
export function validateAttachment(rawName: unknown, rawMime: unknown, rawData: unknown): ValidatedAttachment {
  const mime = normaliseMime(String(rawMime ?? ''));
  const base64 = stripDataUrl(String(rawData ?? ''));
  if (!base64) bad('No file was provided.');

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return bad('The file could not be read. Please choose it again.');
  }
  if (!buf.length) bad('The file is empty.');
  if (buf.length > MAX_ATTACHMENT_BYTES) bad(`The invoice must be ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB or smaller.`);

  const sniffed = sniffAttachment(buf);
  if (!sniffed) bad('That file is not a PNG, JPG, WebP or PDF.');
  if (sniffed !== mime) bad('The file type does not match its contents. Please choose the file again.');

  return { name: cleanName(rawName, mime), mime, data: buf.toString('base64') };
}
