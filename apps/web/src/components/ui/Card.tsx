import type { CSSProperties, ReactNode } from 'react';
import { isUiV2 } from '../../lib/ui-flag';

/** Mix Nova surface card with an optional header (title + actions). */
export function Card({
  title,
  actions,
  children,
  padded = true,
  style,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
}) {
  const v2 = isUiV2();
  return (
    <section className="mn-card" style={style}>
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: v2 ? '16px 20px' : '14px 18px',
            borderBottom: '1px solid var(--mn-border)',
          }}
        >
          {typeof title === 'string' ? (
            <h3
              style={{
                margin: 0,
                fontSize: v2 ? 16 : 15,
                fontWeight: v2 ? 600 : undefined,
                letterSpacing: v2 ? '-0.01em' : undefined,
                fontFamily: 'var(--mn-font-display)',
              }}
            >
              {title}
            </h3>
          ) : (
            title
          )}
          {actions ? <div style={{ display: 'flex', gap: 8 }}>{actions}</div> : null}
        </div>
      )}
      <div style={{ padding: padded ? (v2 ? 20 : 18) : 0 }}>{children}</div>
    </section>
  );
}
