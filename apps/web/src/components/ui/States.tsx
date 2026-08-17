import type { ReactNode } from 'react';
import { Loader2, Inbox, AlertTriangle, Lock } from 'lucide-react';

/** Inline loading spinner + label. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--mn-muted)', padding: 16 }}
    >
      <Loader2 size={18} className="mn-spin" aria-hidden />
      <span style={{ fontSize: 14 }}>{label}</span>
    </div>
  );
}

/** Skeleton placeholder block. */
export function Skeleton({ width = '100%', height = 16, radius }: { width?: number | string; height?: number; radius?: number }) {
  return <div className="mn-skel" style={{ width, height, borderRadius: radius }} />;
}

/**
 * Table skeleton — shimmer rows shown while a list's first page loads, so the
 * screen never flashes its empty state before the data arrives.
 */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 12, padding: 16 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} height={14} width={c === 0 ? '55%' : '80%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Empty state — icon + message + optional action. */
export function EmptyState({
  title = 'Nothing here yet',
  description,
  icon,
  action,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 8, padding: '40px 20px', textAlign: 'center' }}>
      <span
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--mn-purple-50)',
          color: 'var(--mn-primary)',
        }}
        aria-hidden
      >
        {icon ?? <Inbox size={22} />}
      </span>
      <div style={{ fontFamily: 'var(--mn-font-display)', fontWeight: 600, fontSize: 16, color: 'var(--mn-text)' }}>
        {title}
      </div>
      {description && <div style={{ fontSize: 13, color: 'var(--mn-muted)', maxWidth: 360 }}>{description}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

/** Error banner — danger tint + icon + message + optional retry. */
export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 'var(--mn-radius-md)',
        background: 'var(--mn-danger-tint)',
        border: '1px solid var(--mn-danger)',
        color: 'var(--mn-danger)',
        fontSize: 13,
      }}
    >
      <AlertTriangle size={18} aria-hidden />
      <span style={{ flex: 1 }}>{message}</span>
      {action}
    </div>
  );
}

/** Permission-denied state — for a surface the signed-in user may not access. */
export function PermissionDenied({
  message = 'You don’t have permission to view this.',
}: {
  message?: string;
}) {
  return (
    <div
      role="status"
      style={{ display: 'grid', placeItems: 'center', gap: 8, padding: '40px 20px', textAlign: 'center' }}
    >
      <span
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--mn-surface-2)',
          color: 'var(--mn-muted)',
        }}
        aria-hidden
      >
        <Lock size={22} />
      </span>
      <div style={{ fontFamily: 'var(--mn-font-display)', fontWeight: 600, fontSize: 16, color: 'var(--mn-text)' }}>
        Restricted
      </div>
      <div style={{ fontSize: 13, color: 'var(--mn-muted)', maxWidth: 360 }}>{message}</div>
    </div>
  );
}
