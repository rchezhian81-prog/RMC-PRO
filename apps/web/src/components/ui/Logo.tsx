'use client';

import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Mix Nova brand lockup.
 *
 * Uses the REAL logo the moment a file exists in `apps/web/public/brand/`
 * (see README there) — no code change needed. Until then it renders a
 * typographic wordmark placeholder. We never recreate the supplied artwork.
 *
 * Expected files (first that loads wins):
 *   light surfaces → /brand/mix-nova-logo.svg | .png
 *   dark surfaces  → /brand/mix-nova-logo-white.svg | .png (falls back to the above)
 */
const LIGHT = ['/brand/mix-nova-logo.svg', '/brand/mix-nova-logo.png'];
const DARK = ['/brand/mix-nova-logo-white.svg', '/brand/mix-nova-logo-white.png', ...LIGHT];

function useLogoSrc(onDark: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const candidates = onDark ? DARK : LIGHT;
    (async () => {
      for (const c of candidates) {
        const ok = await new Promise<boolean>((res) => {
          const img = new window.Image();
          img.onload = () => res(true);
          img.onerror = () => res(false);
          img.src = c;
        });
        if (cancelled) return;
        if (ok) {
          setSrc(c);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onDark]);
  return src;
}

export function Logo({
  size = 'md',
  showTagline = false,
  onDark = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  onDark?: boolean;
}) {
  const src = useLogoSrc(onDark);
  const imgH = size === 'lg' ? 42 : size === 'sm' ? 26 : 32;

  // Real asset present → use it (the supplied lockup already includes wordmark/tagline).
  if (src) {
    return <img src={src} alt="Mix Nova RMC Software" style={{ height: imgH, width: 'auto', display: 'block' }} />;
  }

  // Placeholder wordmark until the asset lands.
  const s = size === 'lg' ? 34 : size === 'sm' ? 24 : 28;
  const word = size === 'lg' ? 24 : size === 'sm' ? 16 : 19;
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
          {onDark ? <span style={{ color: '#E9DDFF' }}>Nova</span> : <span className="mn-gradient-text">Nova</span>}
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
