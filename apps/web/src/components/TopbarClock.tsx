'use client';

import { useEffect, useState } from 'react';

/** "Sat 11 Oct 2026 · 14:32" in the viewer's own clock, en-IN, 24-hour. */
export function formatClock(d: Date): string {
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

/**
 * The date and time in the top bar, so a person filling a challan or a receipt
 * sees the clock the document will carry. Rendered only after mount (the server
 * has no idea what the viewer's clock says, and a mismatch would flash), then
 * kept within half a minute of true. Hidden on a phone, where the bar has no
 * room for it.
 */
export function TopbarClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!now) return null;
  return (
    <time className="mn-topbar-clock" dateTime={now.toISOString()} aria-label="Current date and time">
      {formatClock(now)}
    </time>
  );
}
