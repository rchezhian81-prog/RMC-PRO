import type { CSSProperties, ElementType, ReactNode } from 'react';

/**
 * Shared surface primitive — the base for every U1 command surface.
 *   plain   → flat card ground
 *   raised  → soft matte elevation
 *   command → near-opaque glass-adjacent command ground (tint + hairline + lift)
 */
export function Surface({
  variant = 'plain',
  as: Tag = 'div',
  padded = false,
  className = '',
  style,
  children,
}: {
  variant?: 'plain' | 'raised' | 'command';
  as?: ElementType;
  padded?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const cls = [
    'mn-surface',
    variant === 'raised' ? 'mn-surface-raised' : variant === 'command' ? 'mn-surface-command' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={cls} style={{ ...(padded ? { padding: 16 } : {}), ...style }}>
      {children}
    </Tag>
  );
}
