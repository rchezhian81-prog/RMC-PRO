'use client';

import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Mix Nova brand lockup.
 *
 * Renders the real logo from `apps/web/public/brand/` (see README there): the
 * horizontal lockup (emblem + "MIX NOVA / RMC SOFTWARE") everywhere, and the
 * stacked lockup with the tagline where `showTagline` asks for it. An SVG with
 * the same name wins over the PNG the moment one is exported from the design
 * source. Should every file be missing, a typographic wordmark stands in so
 * the brand never disappears.
 *
 * Files (first that loads wins):
 *   light surfaces → /brand/mix-nova-logo.svg | .png
 *   dark surfaces  → /brand/mix-nova-logo-white.svg | .png (falls back to the above)
 *   stacked + tagline → /brand/mix-nova-lockup(-white).svg | .png
 */
const LIGHT = ['/brand/mix-nova-logo.svg', '/brand/mix-nova-logo.png'];
const DARK = ['/brand/mix-nova-logo-white.svg', '/brand/mix-nova-logo-white.png', ...LIGHT];
const STACKED = ['/brand/mix-nova-lockup.svg', '/brand/mix-nova-lockup.png'];
const STACKED_DARK = ['/brand/mix-nova-lockup-white.svg', '/brand/mix-nova-lockup-white.png', ...STACKED];

function probe(candidates: string[], apply: (src: string) => void): () => void {
  let cancelled = false;
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
        apply(c);
        return;
      }
    }
  })();
  return () => {
    cancelled = true;
  };
}

function useLogoSrc(onDark: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const candidates = onDark ? DARK : LIGHT;
    return probe(candidates, setSrc);
  }, [onDark]);
  return src;
}

function useStackedSrc(onDark: boolean, wanted: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    return probe(onDark ? STACKED_DARK : STACKED, setSrc);
  }, [onDark, wanted]);
  return wanted ? src : null;
}

/** True while <html data-theme="dark">; follows the theme toggle live. */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.getAttribute('data-theme') === 'dark');
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function Logo({
  size = 'md',
  showTagline = false,
  onDark: onDarkProp,
}: {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  /** Use the on-dark lockup. Omitted: follows the page theme (dark theme → on-dark lockup). */
  onDark?: boolean;
}) {
  const themeDark = useDarkTheme();
  const onDark = onDarkProp ?? themeDark;
  const src = useLogoSrc(onDark);
  const stacked = useStackedSrc(onDark, showTagline);

  // Stacked lockup (emblem over wordmark and tagline) where the tagline is wanted.
  if (stacked) {
    const h = size === 'lg' ? 168 : size === 'sm' ? 96 : 128;
    return <img src={stacked} alt="Mix Nova RMC Software — Smart Mix. Stronger Future." style={{ height: h, width: 'auto', display: 'block' }} />;
  }
  // Horizontal lockup everywhere else.
  if (src) {
    const h = size === 'lg' ? 52 : size === 'sm' ? 34 : 40;
    return <img src={src} alt="Mix Nova RMC Software" style={{ height: h, width: 'auto', display: 'block' }} />;
  }

  // Typographic stand-in, only while no file has loaded.
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
