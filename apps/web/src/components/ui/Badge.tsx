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

/**
 * Map a domain status string to a semantic tone.
 *
 * Every status the API can emit should appear here — an unmapped status falls
 * back to neutral grey, which makes a blocking state (credit hold, unpaid,
 * uninvoiced) look as harmless as a routine one. Keep this in sync with the
 * status defaults in the API migrations.
 */
export function statusTone(status: string): Tone {
  const s = (status || '').toLowerCase();
  if (
    ['approved', 'confirmed', 'delivered', 'paid', 'posted', 'active', 'completed', 'done', 'available', 'resolved',
      // A cheque that has cleared the bank.
      'realised', 'cleared',
      // Purchase: goods fully received, and a bill whose 3-way match is clean.
      'received', 'matched'].includes(s)
  )
    return 'success';
  if (
    [
      'partially_paid', 'on_hold', 'hold', 'low_stock', 'pending_approval',
      // Purchase: partly received, or a bill needing attention on the 3-way match.
      'partially_received', 'over_tolerance', 'unmatched',
      // Blocking or money-at-risk states — must not read as routine.
      'credit_hold', 'unpaid', 'not_invoiced', 'not_checked', 'expired',
      // Subscription is overdue but the plant is still allowed to work.
      'grace',
    ].includes(s)
  )
    return 'warning';
  if (
    [
      'cancelled', 'rejected', 'negative_stock', 'blocked', 'overdue', 'failed', 'inactive',
      // Subscription blocked: nobody at this company can sign in.
      'suspended',
      // Bad debt written off, and a bounced / reversed receipt — money lost or clawed back.
      'written_off', 'bounced', 'reversed',
    ].includes(s)
  )
    return 'danger';
  if (
    [
      'submitted', 'pending', 'batching', 'in_progress', 'in_transit', 'dispatched', 'invoiced',
      'issued', 'waiting', 'queued', 'planned', 'open', 'scheduled', 'partially_delivered', 'trial',
    ].includes(s)
  )
    return 'info';
  // Genuinely neutral: not started / nothing to act on yet.
  if (['draft', 'new', 'not_generated', 'none'].includes(s)) return 'neutral';
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
