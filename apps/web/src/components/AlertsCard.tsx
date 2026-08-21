'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, AlertOctagon, Info, BellRing, RefreshCw, CheckCircle2, ChevronRight } from 'lucide-react';
import { alertsApi, type Alert } from '../lib/api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { ErrorState } from './ui/States';
import { isUiV2 } from '../lib/ui-flag';

const STYLE: Record<Alert['severity'], { color: string; tint: string; icon: typeof Info; label: string }> = {
  danger: { color: 'var(--mn-danger)', tint: 'var(--mn-danger-tint)', icon: AlertOctagon, label: 'Action needed' },
  warning: { color: 'var(--mn-warning)', tint: 'var(--mn-warning-tint)', icon: AlertTriangle, label: 'Attention' },
  info: { color: 'var(--mn-info)', tint: 'var(--mn-info-tint)', icon: Info, label: 'For information' },
};

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

  const urgent = (alerts ?? []).filter((a) => a.severity !== 'info').length;

  // V2 severity rail: a left accent keyline whose colour reflects the most-severe
  // alert, so the whole card signals the day's state at a glance. Neutral while
  // loading/unknown; green when all-clear. Flag-OFF passes no style (unchanged).
  const railColor = !alerts
    ? 'var(--mn-border-strong)'
    : alerts.some((a) => a.severity === 'danger')
      ? 'var(--mn-danger)'
      : alerts.some((a) => a.severity === 'warning')
        ? 'var(--mn-warning)'
        : alerts.length
          ? 'var(--mn-info)'
          : 'var(--mn-success)';
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
          {alerts.map((a, i) => {
            const s = STYLE[a.severity];
            const Icon = s.icon;
            return (
              <Link
                key={a.key}
                href={a.href}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '12px 16px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--mn-border)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    background: s.tint,
                    color: s.color,
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
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{a.title}</span>
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
