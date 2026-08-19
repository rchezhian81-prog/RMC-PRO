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
  const inner = (
    <div
      className="mn-card"
      style={{
        padding: v2 ? 20 : 16,
        minWidth: 168,
        height: '100%',
        display: 'grid',
        gap: v2 ? 14 : 10,
        ...(gradient ? { background: 'var(--mn-gradient)', border: 'none', color: '#fff' } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: v2 ? 11.5 : 11,
            fontWeight: 600,
            letterSpacing: v2 ? '0.05em' : '0.03em',
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
              width: v2 ? 38 : 30,
              height: v2 ? 38 : 30,
              borderRadius: v2 ? 12 : 8,
              flex: '0 0 auto',
              background: gradient
                ? 'rgba(255,255,255,0.18)'
                : v2
                  ? 'linear-gradient(135deg, #f4eeff 0%, #e9ddff 100%)'
                  : 'var(--mn-purple-50)',
              color: gradient ? '#fff' : 'var(--mn-primary)',
              boxShadow: v2 && !gradient ? 'inset 0 0 0 1px rgba(124,58,237,0.10)' : undefined,
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
          fontSize: v2 ? 34 : 26,
          letterSpacing: v2 ? '-0.03em' : undefined,
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
