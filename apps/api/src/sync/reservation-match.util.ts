/**
 * Does this document number come out of that reserved block?
 *
 * A device draws numbers from blocks the cloud hands it, and the cloud tracks
 * how much of a block is spent so the Devices screen can warn before a tablet
 * runs dry. Deciding whether a given challan number came from a block used to
 * be `documentNo.match(/(\d+)/)` — the first digit run ANYWHERE in the string.
 *
 * That is wrong for any number a person typed. "MANUAL-2026-45", a site
 * reference, an imported legacy number: each yields a figure, and if that
 * figure happened to fall inside a live block, the block was marked spent up to
 * that point. The screen then reported a device about to run dry when it had
 * barely started — the one question the screen exists to answer.
 *
 * A block knows exactly how its numbers look: prefix, zero-padded figure,
 * suffix (which carries the financial-year token after a roll-over). Only a
 * string with that exact shape, whose figure lies in the block's range, is one
 * of its numbers.
 */

export interface ReservationBlock {
  prefix: string | null;
  suffix: string | null;
  padding_length: number | string;
  number_from: number | string;
  number_to: number | string;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The figure `documentNo` carries if it is one of `block`'s numbers, else null.
 *
 * The padded width is a minimum, not a maximum: a series that runs past its
 * padding (9999 → 10000 at padding 4) keeps issuing valid numbers.
 */
export function numberWithinBlock(documentNo: string, block: ReservationBlock): number | null {
  const value = String(documentNo ?? '').trim();
  if (!value) return null;

  const padding = Math.max(1, Number(block.padding_length) || 1);
  const from = Number(block.number_from);
  const to = Number(block.number_to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  const shape = new RegExp(`^${escape(block.prefix ?? '')}(\\d{${padding},})${escape(block.suffix ?? '')}$`);
  const m = shape.exec(value);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < from || n > to) return null;
  return n;
}
