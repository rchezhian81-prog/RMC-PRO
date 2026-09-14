/**
 * Cube-sampling frequency (IS 456:2000 §15.2.2, Table 10).
 *
 * A cube test proves nothing about concrete it was not taken from, so the
 * standard fixes how many samples must be cast for a given quantity of
 * concrete. One sample is one set of cubes (three specimens, one test result).
 *
 *   quantity of concrete (m³)   samples
 *   1 – 5                       1
 *   6 – 15                      2
 *   16 – 30                     3
 *   31 – 50                     4
 *   51 and above                4, plus one for each additional 50 m³ or part
 *
 * Table 10 also notes that at least one sample is taken from each shift; the
 * "1" for anything up to 5 m³ covers that for a day with any production at all.
 *
 * The quantity is judged per plant, per day, per grade. Per grade because a
 * sample belongs to the mix it was taken from — an M20 cube says nothing about
 * the M25 poured beside it — and per day because that is the unit an auditor
 * asks about. Nothing here was modelled before: the register could show every
 * cube set ever cast and still not answer "did you cast enough for what you
 * produced on Tuesday?", which is the first QC question an inspector asks.
 *
 * Pure and database-free; the SQL that feeds it lives in the QC service.
 */

/** Samples IS 456 Table 10 requires for a quantity of concrete, in m³. */
export function requiredSamples(quantityM3: number): number {
  const q = Number(quantityM3);
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (q <= 5) return 1;
  if (q <= 15) return 2;
  if (q <= 30) return 3;
  if (q <= 50) return 4;
  return 4 + Math.ceil((q - 50) / 50);
}

export interface SamplingGroup {
  plantId: string | null;
  plantLabel: string | null;
  /** The plant's calendar day, YYYY-MM-DD. */
  day: string;
  gradeId: string | null;
  gradeLabel: string | null;
  /** Concrete produced on confirmed batch tickets, m³. */
  producedM3: number;
  /** Cube sets cast that day for that grade. */
  samplesCast: number;
}

export interface SamplingLine extends SamplingGroup {
  samplesRequired: number;
  shortfall: number;
  compliant: boolean;
}

export interface SamplingSummary {
  rows: SamplingLine[];
  /** Groups (plant × day × grade) with production. */
  groups: number;
  underSampled: number;
  totalProducedM3: number;
  totalRequired: number;
  totalCast: number;
  totalShortfall: number;
}

/** Judge every plant × day × grade against Table 10 and roll the result up. */
export function samplingSummary(groups: SamplingGroup[]): SamplingSummary {
  const rows: SamplingLine[] = groups
    .filter((g) => g.producedM3 > 0)
    .map((g) => {
      const samplesRequired = requiredSamples(g.producedM3);
      const shortfall = Math.max(0, samplesRequired - g.samplesCast);
      return { ...g, samplesRequired, shortfall, compliant: shortfall === 0 };
    })
    .sort((a, b) => (a.day === b.day ? String(a.gradeLabel).localeCompare(String(b.gradeLabel)) : a.day < b.day ? 1 : -1));
  const sum = (f: (r: SamplingLine) => number) => rows.reduce((t, r) => t + f(r), 0);
  return {
    rows,
    groups: rows.length,
    underSampled: rows.filter((r) => !r.compliant).length,
    totalProducedM3: Math.round(sum((r) => r.producedM3) * 1000) / 1000,
    totalRequired: sum((r) => r.samplesRequired),
    totalCast: sum((r) => r.samplesCast),
    totalShortfall: sum((r) => r.shortfall),
  };
}
