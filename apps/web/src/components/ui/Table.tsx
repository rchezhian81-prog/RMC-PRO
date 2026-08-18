import type { CSSProperties, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

/** Responsive table wrapper — scrolls horizontally on narrow screens. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table className="mn-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ numeric, style, children, ...rest }: { numeric?: boolean } & ThHTMLAttributes<HTMLTableCellElement>) {
  const s: CSSProperties = {
    textAlign: numeric ? 'right' : 'left',
    padding: '10px 12px',
    color: 'var(--mn-muted)',
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
    borderBottom: '1px solid var(--mn-border)',
    ...style,
  };
  return (
    <th style={s} {...rest}>
      {children}
    </th>
  );
}

export function Td({ numeric, style, children, ...rest }: { numeric?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  const s: CSSProperties = {
    textAlign: numeric ? 'right' : 'left',
    padding: '10px 12px',
    borderBottom: '1px solid var(--mn-border)',
    color: 'var(--mn-text)',
    ...style,
  };
  return (
    <td style={s} {...rest}>
      {children}
    </td>
  );
}
