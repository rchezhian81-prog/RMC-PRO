import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Tone } from './Badge';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          lineHeight: 1.1,
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
