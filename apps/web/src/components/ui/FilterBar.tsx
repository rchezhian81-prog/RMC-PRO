import type { ReactNode } from 'react';

/** Row of filter/search controls on a surface; wraps on narrow screens. */
export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mn-filterbar" role="search">
      {children}
      {actions && (
        <>
          <span className="mn-toolbar-spacer" />
          {actions}
        </>
      )}
    </div>
  );
}
