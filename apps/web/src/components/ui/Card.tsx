import type { CSSProperties, ReactNode } from 'react';
import { isUiV2 } from '../../lib/ui-flag';

/**
 * Mix Nova surface card with an optional header (title + actions).
 *
 * WHY `minWidth: 0`: most screens lay their cards out in a `display: grid`
 * wrapper, and a grid (or flex) item defaults to `min-width: auto` — it refuses
 * to shrink below its content's intrinsic width. A card holding a wide table
 * therefore pushed its grid track wider than the viewport, and because the card
 * never got narrow, the table's own `overflow-x: auto` scroller never engaged:
 * instead of the TABLE scrolling sideways, the whole PAGE did, dragging the
 * heading and every other card along with it.
 *
 * Measured on a 400px phone before this: Delivery Register 517px wide, Stock
 * 593px, and Billing Reports 901px at a 768px tablet. After: every page exactly
 * its viewport, with the wide tables scrolling inside their own cards.
 */
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

  // ---- V2 (Aurora premium): class-driven header/body so CSS owns the look. ----
  if (v2) {
    return (
      <section className="mn-card" style={{ minWidth: 0, ...style }}>
        {(title || actions) && (
          <div className="mn-card-head">
            {typeof title === 'string' ? (
              <h3 className="mn-card-title">{title}</h3>
            ) : (
              title
            )}
            {actions ? <div className="mn-card-actions">{actions}</div> : null}
          </div>
        )}
        <div className={`mn-card-body${padded ? '' : ' mn-card-body--flush'}`}>{children}</div>
      </section>
    );
  }

  // ---- Legacy (flag-off) — unchanged inline version. ----
  return (
    <section className="mn-card" style={{ minWidth: 0, ...style }}>
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid var(--mn-border)',
          }}
        >
          {typeof title === 'string' ? (
            <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--mn-font-display)' }}>{title}</h3>
          ) : (
            title
          )}
          {actions ? <div style={{ display: 'flex', gap: 8 }}>{actions}</div> : null}
        </div>
      )}
      <div style={{ padding: padded ? 18 : 0 }}>{children}</div>
    </section>
  );
}
