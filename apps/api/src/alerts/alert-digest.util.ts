/**
 * Pure logic for the scheduled alert digest (Tier-5G) — kept separate from the
 * worker's timers and DB so the "what to send / when to send" decisions are
 * unit-testable without a database or a clock.
 *
 * The digest is the push counterpart to the in-app alerts (GET /alerts): once a
 * day it collects the same rule-based alerts, keeps those at or above a minimum
 * severity, and — if any remain — hands the worker a one-line summary plus the
 * bullet lines to push to the ops channel.
 */

export type DigestSeverity = 'danger' | 'warning' | 'info';

const RANK: Record<DigestSeverity, number> = { danger: 3, warning: 2, info: 1 };

export interface DigestAlert {
  key: string;
  severity: DigestSeverity;
  title: string;
  detail?: string;
  count?: number;
  amount?: number;
}

export interface AlertDigest {
  count: number;
  bySeverity: Record<string, number>;
  /** "• <title>" bullet lines, most-severe first. */
  lines: string[];
  /** One-line summary for the push message. */
  text: string;
}

/**
 * Filter alerts to those at/above `minSeverity` and, if any remain, build the
 * digest. Returns null when nothing qualifies — the worker then sends nothing.
 */
export function buildAlertDigest(
  alerts: DigestAlert[],
  minSeverity: DigestSeverity = 'danger',
): AlertDigest | null {
  const floor = RANK[minSeverity];
  const kept = alerts
    .filter((a) => (RANK[a.severity] ?? 0) >= floor)
    .sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0));
  if (kept.length === 0) return null;

  const bySeverity: Record<string, number> = {};
  for (const a of kept) bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;

  const mix = (Object.keys(RANK) as DigestSeverity[])
    .filter((s) => bySeverity[s])
    .map((s) => `${bySeverity[s]} ${s}`)
    .join(', ');

  return {
    count: kept.length,
    bySeverity,
    lines: kept.map((a) => `• ${a.title}`),
    text: `${kept.length} alert${kept.length === 1 ? '' : 's'} need attention (${mix}).`,
  };
}

/**
 * True when a digest is due now: the current UTC hour matches the configured
 * send hour AND a digest has not already been sent today. `lastSentIsoDate` is
 * the YYYY-MM-DD the tenant was last processed, or null if never.
 */
export function shouldSendDigest(now: Date, sendHourUtc: number, lastSentIsoDate: string | null): boolean {
  if (now.getUTCHours() !== sendHourUtc) return false;
  return lastSentIsoDate !== now.toISOString().slice(0, 10);
}
