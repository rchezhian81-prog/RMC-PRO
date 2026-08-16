import type { ReactNode } from 'react';

/** Page-level command bar: title/subtitle on the left, actions on the right. */
export function CommandBar({
  title,
  subtitle,
  actions,
  sticky = false,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`mn-cmdbar ${sticky ? 'mn-cmdbar-sticky' : ''}`.trim()}>
      {(title || subtitle) && (
        <div style={{ minWidth: 0 }}>
          {typeof title === 'string' ? <h1 className="mn-cmdbar-title">{title}</h1> : title}
          {subtitle && <div className="mn-cmdbar-sub">{subtitle}</div>}
        </div>
      )}
      {children}
      {actions && <div className="mn-cmdbar-actions">{actions}</div>}
    </div>
  );
}
