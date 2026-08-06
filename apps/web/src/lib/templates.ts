/** Merge-field rendering for the standard message templates. */

const FIELD_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Friendly fallbacks for fields the caller can't supply from the current screen. */
const FALLBACK: Record<string, string> = {
  contactPerson: 'Sir/Madam',
};

export interface Rendered {
  text: string;
  /** Fields that had no value and were left as a blank to fill in. */
  missing: string[];
}

/**
 * Substitute `{{field}}` placeholders from `values`. A field with no value is
 * replaced with an underscore blank rather than left as raw `{{...}}`, so a
 * half-filled message still reads like a message and the gap is obvious.
 */
export function renderTemplate(body: string, values: Record<string, unknown>): Rendered {
  const missing: string[] = [];
  const text = body.replace(FIELD_RE, (_m, name: string) => {
    const raw = values[name];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') return String(raw);
    if (FALLBACK[name]) return FALLBACK[name] as string;
    if (!missing.includes(name)) missing.push(name);
    return '______';
  });
  return { text, missing };
}

/**
 * Normalise an Indian mobile number to the international form wa.me expects
 * (country code, digits only). Returns null when the number isn't usable.
 */
export function whatsappNumber(mobile: unknown): string | null {
  const d = String(mobile ?? '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** Deep link that opens WhatsApp with the message pre-filled, ready to send. */
export function whatsappLink(mobile: unknown, text: string): string | null {
  const number = whatsappNumber(mobile);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}
