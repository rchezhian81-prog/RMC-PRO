/**
 * Batching-controller log parsing + reconciliation — pure helpers (Plan A4).
 *
 * A plant batching controller (Command Alkon, Sicoma, Schwing, IDS, Putzmeister,
 * …) prints a per-batch report with the actual weighed/dispensed quantity for
 * each material, usually as a delimited text/CSV block, e.g.
 *
 *     Material,Target,Actual
 *     Cement,320.0,318.5
 *     Fine Aggregate,710.0,715.2
 *     Water,160.0,159.0
 *
 * A4 ingests those ACTUALS into a batch ticket instead of hand-keying them and
 * reconciles each line against the ticket's moisture-corrected target, reusing
 * the same variance/tolerance rule the manual path already applies on confirm.
 *
 * These helpers are DB- and IO-free so the parse + reconcile logic is unit
 * tested on its own; the service feeds them a raw log from a simulated source
 * (tested + demo), a plant-side agent (posted text), or a guarded connector.
 */

export interface BatchLogLine {
  /** material name as printed by the controller. */
  material: string;
  /** the actual batched/weighed quantity. */
  actual: number;
  /** the controller's own set/design target, when the report carries it. */
  target?: number;
  unit?: string;
}

export interface TicketTargetLine {
  id: string;
  materialLabel: string | null;
  materialId: string | null;
  /** the basis to reconcile against — the moisture-corrected target (falls back to the raw target). */
  correctedTarget: number;
  tolerance: number;
  uom: string | null;
}

export interface ReconciledLine {
  ticketMaterialId: string;
  materialLabel: string | null;
  /** true when a controller log line was matched to this ticket material. */
  matched: boolean;
  actual: number;
  target: number;
  varianceQuantity: number;
  variancePercentage: number;
  withinTolerance: boolean;
}

export interface Reconciliation {
  /** one entry per ticket target line (matched lines carry the ingested actual). */
  lines: ReconciledLine[];
  /** controller log lines that matched no ticket material (operator should check). */
  unmatchedLog: BatchLogLine[];
  matchedCount: number;
  /** any MATCHED line breaches its tolerance. */
  varianceExceeded: boolean;
}

const HEADER_KEYWORDS = /(material|item|ingredient|product|name|actual|batched|weighed|dispensed|target|design|set|unit|uom)/i;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Loose key so "Fine Aggregate", "fine_aggregate" and "FINE  AGGREGATE" all match. */
const normKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Parse a numeric field tolerating unit suffixes, thousands commas and padding. */
function parseNum(s: unknown): number {
  const t = String(s ?? '')
    .replace(/,/g, '')
    .replace(/[^0-9.\-+]/g, '');
  const m = t.match(/[-+]?\d*\.?\d+/);
  return m ? Number(m[0]) : NaN;
}

function pickDelim(line: string): string {
  if (line.includes('\t')) return '\t';
  if (line.includes(';')) return ';';
  if (line.includes(',')) return ',';
  return ',';
}

/**
 * Parse a controller batch log into per-material actuals. Tolerant of a header
 * row (mapped by keyword) or positional `material,[target,]actual` columns, of
 * comma/semicolon/tab delimiters, unit suffixes, and `#`/`//` comment lines.
 */
export function parseBatchLog(raw: string): BatchLogLine[] {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));
  if (!lines.length) return [];

  const delim = pickDelim(lines[0]!);
  const cells = (l: string) => l.split(delim).map((c) => c.trim());

  const first = cells(lines[0]!);
  const lastCell = first[first.length - 1] ?? '';
  const looksHeader = first.some((c) => HEADER_KEYWORDS.test(c)) && Number.isNaN(parseNum(lastCell));

  let matIdx = 0;
  let actIdx = first.length > 1 ? first.length - 1 : 0;
  let tgtIdx = -1;
  let unitIdx = -1;
  let start = 0;

  if (looksHeader) {
    start = 1;
    first.forEach((c, i) => {
      const k = c.toLowerCase();
      if (/(material|item|ingredient|product|name)/.test(k)) matIdx = i;
      else if (/(actual|batched|weighed|dispensed|delivered)/.test(k)) actIdx = i;
      else if (/(target|design|set|formula|required|tgt)/.test(k)) tgtIdx = i;
      else if (/(unit|uom)/.test(k)) unitIdx = i;
    });
  } else if (first.length >= 3) {
    // positional material, target, actual
    tgtIdx = 1;
    actIdx = 2;
  } else {
    // positional material, actual
    actIdx = first.length - 1;
  }

  const out: BatchLogLine[] = [];
  for (let i = start; i < lines.length; i++) {
    const row = cells(lines[i]!);
    const material = (row[matIdx] ?? '').trim();
    if (!material) continue;
    const actual = parseNum(row[actIdx]);
    if (Number.isNaN(actual)) continue;
    const target = tgtIdx >= 0 ? parseNum(row[tgtIdx]) : NaN;
    const unit = unitIdx >= 0 ? (row[unitIdx] ?? '').trim() : '';
    out.push({
      material,
      actual: round3(actual),
      ...(Number.isNaN(target) ? {} : { target: round3(target) }),
      ...(unit ? { unit } : {}),
    });
  }
  return out;
}

/** The variance/tolerance rule — mirrors BatchTicketsService.variance exactly. */
export function computeVariance(target: number, actual: number, tolerance: number) {
  const varianceQuantity = actual - target;
  const variancePercentage = target !== 0 ? (varianceQuantity / target) * 100 : actual !== 0 ? 100 : 0;
  return {
    varianceQuantity: round3(varianceQuantity),
    variancePercentage: round2(variancePercentage),
    withinTolerance: Math.abs(variancePercentage) <= tolerance,
  };
}

/**
 * Reconcile parsed controller actuals to a ticket's target lines. Matches by a
 * normalised material label; each ticket line gets the matched actual (or stays
 * untouched if the controller didn't report it), scored against its corrected
 * target. Only matched lines can raise `varianceExceeded`.
 */
export function reconcileBatchLog(ticketLines: TicketTargetLine[], log: BatchLogLine[]): Reconciliation {
  const logByKey = new Map<string, BatchLogLine>();
  for (const l of log) {
    const k = normKey(l.material);
    if (k && !logByKey.has(k)) logByKey.set(k, l);
  }
  const usedKeys = new Set<string>();

  const lines: ReconciledLine[] = ticketLines.map((t) => {
    const key = normKey(t.materialLabel ?? '');
    const hit = key ? logByKey.get(key) : undefined;
    if (hit) usedKeys.add(key);
    const actual = hit ? hit.actual : 0;
    const v = computeVariance(t.correctedTarget, actual, t.tolerance);
    return {
      ticketMaterialId: t.id,
      materialLabel: t.materialLabel,
      matched: !!hit,
      actual,
      target: t.correctedTarget,
      varianceQuantity: v.varianceQuantity,
      variancePercentage: v.variancePercentage,
      // an unmatched line is left as-is and never counts as a breach.
      withinTolerance: hit ? v.withinTolerance : true,
    };
  });

  const unmatchedLog = log.filter((l) => !usedKeys.has(normKey(l.material)));
  const matched = lines.filter((l) => l.matched);
  return {
    lines,
    unmatchedLog,
    matchedCount: matched.length,
    varianceExceeded: matched.some((l) => !l.withinTolerance),
  };
}

/**
 * Build a plausible controller batch log from a ticket's target lines — the
 * deterministic simulated source (and the round-trip test fixture). Actuals
 * wobble a few tenths of a percent around target (within any sane tolerance);
 * `breachIndex`/`breachPct` force one line out of tolerance for testing.
 */
export function simulateBatchLog(
  ticketLines: Array<{ materialLabel: string | null; correctedTarget: number; uom?: string | null }>,
  opts?: { breachIndex?: number; breachPct?: number },
): BatchLogLine[] {
  return ticketLines
    .filter((t) => t.materialLabel)
    .map((t, i) => {
      const jitter = ((i % 3) - 1) * 0.004; // -0.4%, 0%, +0.4%
      const factor = opts && opts.breachIndex === i ? 1 + (opts.breachPct ?? 10) / 100 : 1 + jitter;
      return {
        material: t.materialLabel as string,
        actual: round3(t.correctedTarget * factor),
        target: round3(t.correctedTarget),
        ...(t.uom ? { unit: t.uom } : {}),
      };
    });
}
