'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Fades a block in the first time it scrolls into view. Presentation only:
 * the content is in the document from the start (search engines and reduced-
 * motion users see it immediately); the reveal is a CSS class the observer
 * adds once, and the CSS collapses to "always visible" under
 * prefers-reduced-motion.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Already on screen (or no observer available): show at once. Only a block
    // still below the fold is armed to hide-then-reveal, so nothing is ever
    // hidden unless this script has run and can un-hide it.
    if (!('IntersectionObserver' in window) || el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      el.classList.add('is-in');
      return;
    }
    el.classList.add('is-armed');
    const show = () => {
      el.classList.add('is-in');
      io.disconnect();
      window.clearTimeout(safety);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // in view, or already scrolled past in one jump
          if (e.isIntersecting || e.boundingClientRect.top < window.innerHeight) show();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: [0, 0.01] },
    );
    io.observe(el);
    // Safety net: whatever the observer does, nothing stays hidden for long.
    const safety = window.setTimeout(show, 3000);
    return () => {
      io.disconnect();
      window.clearTimeout(safety);
    };
  }, []);
  return (
    <div ref={ref} className={`mn-reveal ${className}`.trim()} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
