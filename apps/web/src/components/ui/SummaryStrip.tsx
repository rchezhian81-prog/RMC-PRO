import type { ReactNode } from 'react';

/** KPI / summary surface — a responsive auto-fit grid, typically of StatCards. */
export function SummaryStrip({ children }: { children: ReactNode }) {
  return <div className="mn-summary">{children}</div>;
}
