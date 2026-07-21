import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'processing';

const TONE: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: 'var(--mn-muted)', bg: 'var(--mn-surface-2)' },
  success: { fg: 'var(--mn-success)', bg: 'var(--mn-success-tint)' },
  warning: { fg: 'var(--mn-warning)', bg: 'var(--mn-warning-tint)' },
  danger: { fg: 'var(--mn-danger)', bg: 'var(--mn-danger-tint)' },
  info: { fg: 'var(--mn-info)', bg: 'var(--mn-info-tint)' },
  processing: { fg: 'var(--mn-info)', bg: 'var(--mn-info-tint)' },
};

/** Map a domain status string to a semantic tone (color + label always). */
export function statusTone(status: string): Tone {
  const s = (status || '').toLowerCase();
  if (['approved', 'confirmed', 'delivered', 'paid', 'posted', 'active', 'completed'].includes(s))
    return 'success';
  if (['partially_paid', 'on_hold', 'hold', 'low_stock', 'pending_approval'].includes(s)) return 'warning';
  if (['cancelled', 'rejected', 'negative_stock', 'blocked', 'overdue', 'failed'].includes(s))
    return 'danger';
  if (['submitted', 'pending', 'batching', 'in_progress', 'in_transit', 'dispatched', 'invoiced'].includes(s))
    return 'info';
  return 'neutral';
}

/** Mix Nova status badge — dark-text-on-tint pill. */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <span className="mn-badge" style={{ color: t.fg, background: t.bg }}>
      {icon}
      {children}
    </span>
  );
}

/** Badge that derives its tone from a raw status string. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Badge>;
}
