import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Tone } from './Badge';
import { isUiV2 } from '../../lib/ui-flag';

const ACCENT: Record<Tone, string> = {
  neutral: 'var(--mn-text)',
  success: 'var(--mn-success)',
  warning: 'var(--mn-warning)',
  danger: 'var(--mn-danger)',
  info: 'var(--mn-info)',
  processing: 'var(--mn-info)',
};

/** Mix Nova KPI tile: icon chip + label + big display value; optional link + accent. */
export function StatCard({
  label,
  value,
  icon,
  tone = 'neutral',
  href,
  gradient = false,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
  gradient?: boolean;
}) {
  const v2 = isUiV2();

  // ---- V2 (Aurora premium): class-driven so CSS owns tone, hover, keyline. ----
  if (v2) {
    const inner = (
      <div className={`mn-card mn-stat${gradient ? ' mn-stat--grad' : ''}`} data-tone={tone}>
        <div className="mn-stat-top">
          <span className="mn-stat-label">{label}</span>
          {icon && <span className="mn-stat-chip">{icon}</span>}
        </div>
        <div className="mn-stat-value">{value}</div>
      </div>
    );
    return href ? (
      <Link href={href} className="mn-stat-link" style={{ textDecoration: 'none' }}>
        {inner}
      </Link>
    ) : (
      inner
    );
  }

  // ---- Legacy (flag-off) — unchanged inline version. ----
  const inner = (
    <div
      className="mn-card"
      style={{
        padding: 16,
        minWidth: 168,
        height: '100%',
        display: 'grid',
        gap: 10,
        ...(gradient ? { background: 'var(--mn-gradient)', border: 'none', color: '#fff' } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: gradient ? 'rgba(255,255,255,0.85)' : 'var(--mn-muted)',
          }}
        >
          {label}
        </span>
        {icon && (
          <span
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 30,
              height: 30,
              borderRadius: 8,
              flex: '0 0 auto',
              background: gradient ? 'rgba(255,255,255,0.18)' : 'var(--mn-purple-50)',
              color: gradient ? '#fff' : 'var(--mn-primary)',
            }}
          >
            {icon}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--mn-font-display)',
          fontWeight: 700,
          fontSize: 26,
          lineHeight: 1.05,
          color: gradient ? '#fff' : ACCENT[tone],
        }}
      >
        {value}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: 'none' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}
