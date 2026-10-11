import type { AlertSeverity } from '../lib/api';

/**
 * The three severities, each as colour + word, in the order the lists sort.
 * Colour never carries the meaning alone: the word is always beside it.
 */
export const SEVERITY_ORDER: AlertSeverity[] = ['high', 'medium', 'low'];
export const SEVERITY_LABEL: Record<AlertSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const SEVERITY_COLOR: Record<AlertSeverity, { color: string; tint: string }> = {
  high: { color: 'var(--mn-danger)', tint: 'var(--mn-danger-tint)' },
  medium: { color: 'var(--mn-warning)', tint: 'var(--mn-warning-tint)' },
  low: { color: 'var(--mn-info)', tint: 'var(--mn-info-tint)' },
};

/** One severity as a small pill: a dot in its colour and the word. */
export function SeverityChip({ severity, onDark = false }: { severity: AlertSeverity; onDark?: boolean }) {
  return (
    <span className={`mn-sev-chip${onDark ? ' mn-sev-chip--dark' : ''}`} data-severity={severity}>
      <span className="mn-sev-dot" aria-hidden />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/**
 * The legend row: High, Medium, Low. `lead` is the short phrase before the
 * chips ("Severity", "Tile tones"); `onDark` picks the on-gradient styling
 * for the dashboard hero.
 */
export function SeverityLegend({ lead, onDark = false }: { lead?: string; onDark?: boolean }) {
  return (
    <div className={`mn-sev-legend${onDark ? ' mn-sev-legend--dark' : ''}`} role="list" aria-label="Severity legend">
      {lead && <span className="mn-sev-lead">{lead}</span>}
      {SEVERITY_ORDER.map((s) => (
        <span role="listitem" key={s}>
          <SeverityChip severity={s} onDark={onDark} />
        </span>
      ))}
    </div>
  );
}
