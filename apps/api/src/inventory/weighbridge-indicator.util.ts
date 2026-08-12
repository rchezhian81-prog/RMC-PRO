/**
 * Weighbridge indicator protocol — pure helpers (Plan E1).
 *
 * A weighbridge "indicator" (the digital head wired to the load cells) streams
 * short ASCII frames over serial/COM or a TCP socket. The de-facto SI / A&D /
 * Sartorius line format is:
 *
 *     <STX> ST,GS,+  1234.5 kg <CR><ETX>
 *
 *   token 1  stability — ST (stable) | US (unstable) | OL (overload)
 *   token 2  weight type — GS (gross) | NT (net)
 *   then     a signed, possibly zero/space-padded number and a unit (kg|t|g|lb)
 *
 * These helpers are DB- and IO-free so the parse/decision logic is unit-tested
 * on its own; the service layer feeds them raw frames from either a simulated
 * source (tested here + in CI) or a real serial/TCP adapter (guarded, never hit
 * in CI). Nothing here throws on hardware — only on genuinely unparseable text.
 */

export type WeightType = 'gross' | 'net' | 'unknown';
export type WeightUnit = 'kg' | 't' | 'g' | 'lb';

export interface IndicatorReading {
  /** true only when the indicator explicitly flagged the reading stable (ST). */
  stable: boolean;
  /** the load cell is over its rated capacity (OL) — weight is not usable. */
  overload: boolean;
  type: WeightType;
  /** weight in the reported `unit`. */
  weight: number;
  unit: WeightUnit;
  /** weight normalised to kilograms (the weighbridge stores kg). */
  weightKg: number;
  /** the original frame, for the audit trail. */
  raw: string;
}

// Strip STX/ETX/CR/LF/NUL and any other C0 control byte the head may frame with.
// eslint-disable-next-line no-control-regex -- indicator frames are control-delimited by design
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
// Standalone ST/US/OL/GS/NT status/type tokens (not part of a longer word).
const STATUS_TYPE_TOKENS = /(?<![A-Za-z0-9])(ST|US|OL|GS|NT)(?![A-Za-z0-9])/gi;
const UNIT_FACTOR_KG: Record<WeightUnit, number> = { kg: 1, t: 1000, g: 0.001, lb: 0.45359237 };

const badFrame = (raw: string) =>
  new Error(`Unparseable weighbridge indicator frame: ${JSON.stringify(String(raw).slice(0, 64))}`);

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const token = (code: string) => new RegExp(`(?<![A-Za-z0-9])${code}(?![A-Za-z0-9])`, 'i');

/** Convert a weight in `unit` to kilograms. */
export function toKg(weight: number, unit: WeightUnit): number {
  return round3(weight * (UNIT_FACTOR_KG[unit] ?? 1));
}

/**
 * Parse one raw indicator frame into a structured reading. Tolerant of the
 * common real-world variations (comma- or space-separated tokens, sign/zero/
 * space padding, a comma before the unit, and a bare number with no ST/GS
 * prefix). Throws only when no number can be recovered and it is not an
 * overload frame.
 */
export function parseIndicatorFrame(raw: string): IndicatorReading {
  const clean = String(raw ?? '').replace(CONTROL_CHARS, ' ').trim();
  if (!clean) throw badFrame(raw);

  const hasStable = token('ST').test(clean);
  const hasUnstable = token('US').test(clean);
  const overload = token('OL').test(clean);
  const type: WeightType = token('NT').test(clean) ? 'net' : token('GS').test(clean) ? 'gross' : 'unknown';

  // Drop the recognised status/type tokens so they cannot be mistaken for the
  // number or the unit — the 'T' in "NT" would otherwise read as tonnes.
  const body = clean.replace(STATUS_TYPE_TOKENS, ' ');

  // Signed number, tolerating spaces between the sign and the digits.
  const numMatch = body.match(/[-+]?\s*\d[\d\s]*(?:\.\d+)?/);
  if (!numMatch && !overload) throw badFrame(raw);
  const weight = numMatch ? Number(numMatch[0].replace(/\s+/g, '')) : 0;
  if (numMatch && !Number.isFinite(weight)) throw badFrame(raw);

  // Unit is the trailing alpha token; default kg when the indicator omits it.
  const unitMatch = body.match(/(kg|lb|t|g)\b/i);
  const unit = (unitMatch?.[1]?.toLowerCase() ?? 'kg') as WeightUnit;

  return {
    stable: hasStable ? true : hasUnstable ? false : false,
    overload,
    type,
    weight,
    unit,
    weightKg: toKg(weight, unit),
    raw: clean,
  };
}

/**
 * Build a canonical indicator frame for a given weight — used by the simulated
 * source and by the round-trip unit tests. Inverse of {@link parseIndicatorFrame}
 * for the fields it carries.
 */
export function simulateIndicatorFrame(opts: {
  weight: number;
  unit?: WeightUnit;
  type?: 'gross' | 'net';
  stable?: boolean;
}): string {
  const unit = opts.unit ?? 'kg';
  const typeTok = opts.type === 'net' ? 'NT' : 'GS';
  const statusTok = opts.stable === false ? 'US' : 'ST';
  const sign = opts.weight < 0 ? '-' : '+';
  const decimals = unit === 'g' || unit === 't' ? 3 : 1;
  const magnitude = Math.abs(opts.weight).toFixed(decimals).padStart(8, '0');
  return `${statusTok},${typeTok},${sign}${magnitude} ${unit}`;
}

/**
 * A deterministic "settling" burst: the indicator wobbles for a couple of
 * frames, then reports a stable reading — exactly what a real head does as a
 * truck rolls onto the platform. Feeds {@link pickStableReading}.
 */
export function simulateIndicatorBurst(weightKg: number, unit: WeightUnit = 'kg'): string[] {
  return [
    simulateIndicatorFrame({ weight: round3(weightKg * 0.6), unit, stable: false }),
    simulateIndicatorFrame({ weight: round3(weightKg * 0.94), unit, stable: false }),
    simulateIndicatorFrame({ weight: weightKg, unit, stable: true }),
  ];
}

/**
 * Pick the reading to trust from a burst of frames: the last stable,
 * non-overload frame. Throws if the platform never settled or is overloaded —
 * the caller surfaces that as "re-weigh", never a silent bad number.
 */
export function pickStableReading(frames: string[]): IndicatorReading {
  const readings = (frames ?? [])
    .map((f) => {
      try {
        return parseIndicatorFrame(f);
      } catch {
        return null;
      }
    })
    .filter((r): r is IndicatorReading => r !== null);

  if (readings.some((r) => r.overload)) {
    throw new Error('Weighbridge indicator reports OVERLOAD — remove load and re-weigh');
  }
  const stable = readings.filter((r) => r.stable);
  const last = stable[stable.length - 1];
  if (!last) {
    throw new Error('Weighbridge indicator never reported a stable reading');
  }
  return last;
}
