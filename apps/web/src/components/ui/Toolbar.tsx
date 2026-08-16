import type { ReactNode } from 'react';

/**
 * Table toolbar. Shows a row count, or — when rows are selected — a selection
 * summary and bulk actions on a highlighted ground.
 */
export function Toolbar({
  count,
  selectedCount,
  actions,
  children,
}: {
  count?: ReactNode;
  selectedCount?: number;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const selected = typeof selectedCount === 'number' && selectedCount > 0;
  return (
    <div
      className={`mn-toolbar ${selected ? 'mn-toolbar-selected' : ''}`.trim()}
      role="toolbar"
      aria-label="Table actions"
    >
      {selected ? (
        <span className="mn-toolbar-count" aria-live="polite">
          {selectedCount} selected
        </span>
      ) : count != null ? (
        <span className="mn-toolbar-count">{count}</span>
      ) : null}
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
