import type { CSSProperties } from 'react';

/**
 * Mix Nova brand lockup.
 *
 * PLACEHOLDER: renders the product wordmark in the brand font + Nova gradient.
 * We intentionally do NOT recreate the supplied logo artwork. When the official
 * logo is dropped into `apps/web/public/brand/` (see README there), swap the
 * `mark` below for `<img src="/brand/mix-nova-logo.svg" alt="Mix Nova" />`.
 */
export function Logo({
  size = 'md',
  showTagline = false,
  onDark = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  onDark?: boolean;
}) {
  const s = size === 'lg' ? 34 : size === 'sm' ? 24 : 28;
  const word = size === 'lg' ? 24 : size === 'sm' ? 16 : 19;

  // On dark/gradient surfaces invert the mark (white tile, gradient "M") and use
  // light wordmark colors so the lockup stays legible; on light surfaces use the
  // gradient tile + gradient "Nova".
  const mark: CSSProperties = {
    width: s,
    height: s,
    borderRadius: Math.round(s * 0.28),
    background: onDark ? '#ffffff' : 'var(--mn-gradient)',
    display: 'inline-grid',
    placeItems: 'center',
    fontFamily: 'var(--mn-font-display)',
    fontWeight: 700,
    fontSize: Math.round(s * 0.56),
    lineHeight: 1,
    boxShadow: onDark ? '0 2px 10px rgba(0,0,0,0.25)' : '0 2px 8px rgba(108,43,217,0.35)',
    flex: '0 0 auto',
    color: onDark ? undefined : '#fff',
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={mark} aria-hidden>
        <span className={onDark ? 'mn-gradient-text' : undefined}>M</span>
      </span>
      <span style={{ display: 'grid', lineHeight: 1.05 }}>
        <span
          style={{
            fontFamily: 'var(--mn-font-display)',
            fontWeight: 700,
            fontSize: word,
            letterSpacing: '-0.02em',
            color: onDark ? '#fff' : 'var(--mn-text)',
          }}
        >
          Mix{' '}
          {onDark ? (
            <span style={{ color: '#E9DDFF' }}>Nova</span>
          ) : (
            <span className="mn-gradient-text">Nova</span>
          )}
        </span>
        {showTagline && (
          <span
            style={{
              fontSize: Math.max(10, word * 0.5),
              color: onDark ? 'rgba(255,255,255,0.72)' : 'var(--mn-muted)',
              letterSpacing: '0.01em',
              marginTop: 2,
            }}
          >
            Smart Mix. Stronger Future.
          </span>
        )}
      </span>
    </div>
  );
}
