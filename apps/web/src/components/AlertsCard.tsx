'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, AlertOctagon, Info, BellRing, RefreshCw, CheckCircle2, ChevronRight } from 'lucide-react';
import { alertsApi, type Alert, type AlertSeverity } from '../lib/api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { ErrorState } from './ui/States';
import { isUiV2 } from '../lib/ui-flag';
import { SeverityLegend, SEVERITY_COLOR, SEVERITY_LABEL, SEVERITY_ORDER } from './SeverityLegend';

/** Icon per severity; the colours come from the shared legend so the two always agree. */
const ICON: Record<AlertSeverity, typeof Info> = { high: AlertOctagon, medium: AlertTriangle, low: Info };
const RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

/** An alert from before the severity word existed is read from its tone. */
function severityOf(a: Alert): AlertSeverity {
  if (a.severity in RANK) return a.severity;
  const t = a.tone ?? 'info';
  return t === 'danger' ? 'high' : t === 'warning' ? 'medium' : 'low';
}

/**
 * "What needs attention today" — computed from the plant's own data by SQL
 * rules, so it is instant, costs nothing, and is always available.
 */
export function AlertsCard() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await alertsApi.list();
      setAlerts(r.alerts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load alerts.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // High first, then medium, then low; the API sorts the same way, but the
  // order is part of the card's promise, so it does not rely on that.
  const sorted = (alerts ?? [])
    .map((a) => ({ a, s: severityOf(a) }))
    .sort((x, y) => RANK[x.s] - RANK[y.s]);
  const urgent = sorted.filter((x) => x.s !== 'low').length;

  // V2 severity rail: a left accent keyline whose colour reflects the most-severe
  // alert, so the whole card signals the day's state at a glance. Neutral while
  // loading/unknown; green when all-clear. Flag-OFF passes no style (unchanged).
  const worst = SEVERITY_ORDER.find((s) => sorted.some((x) => x.s === s));
  const railColor = !alerts ? 'var(--mn-border-strong)' : worst ? SEVERITY_COLOR[worst].color : 'var(--mn-success)';
  const railStyle = isUiV2() ? { borderLeft: `3px solid ${railColor}` } : undefined;

  return (
    <Card
      style={railStyle}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <BellRing size={16} color="var(--mn-primary)" /> Needs attention
          {urgent > 0 && (
            <span
              style={{
                background: 'var(--mn-danger-tint)',
                color: 'var(--mn-danger)',
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {urgent}
            </span>
          )}
        </span>
      }
      actions={
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={load} loading={busy}>
          Refresh
        </Button>
      }
      padded={false}
    >
      {error ? (
        <div style={{ padding: 16 }}>
          <ErrorState message={error} />
        </div>
      ) : busy && !alerts ? (
        <p style={{ margin: 0, padding: 16, color: 'var(--mn-muted)', fontSize: 13 }}>Checking your plant…</p>
      ) : !alerts?.length ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 16 }}>
          <CheckCircle2 size={18} color="var(--mn-success)" />
          <span style={{ fontSize: 13.5 }}>All clear — nothing needs attention right now.</span>
        </div>
      ) : (
        <div>
          <div className="mn-alerts-legend">
            <SeverityLegend lead="Severity" />
          </div>
          {sorted.map(({ a, s }, i) => {
            const c = SEVERITY_COLOR[s];
            const Icon = ICON[s];
            return (
              <Link
                key={a.key}
                href={a.href}
                className="mn-alert-row"
                data-severity={s}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '12px 16px 12px 13px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--mn-border)',
                  borderLeft: `3px solid ${c.color}`,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    background: c.tint,
                    color: c.color,
                    borderRadius: 8,
                    width: 30,
                    height: 30,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                    <span className="mn-sev-badge" data-severity={s} style={{ color: c.color, background: c.tint }}>
                      {SEVERITY_LABEL[s]}
                    </span>
                  </span>
                  <span style={{ display: 'block', color: 'var(--mn-muted)', fontSize: 12.5, marginTop: 2 }}>
                    {a.detail}
                  </span>
                </span>
                <ChevronRight size={16} color="var(--mn-subtle)" style={{ flexShrink: 0, marginTop: 7 }} />
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
