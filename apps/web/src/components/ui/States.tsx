import type { ReactNode } from 'react';
import { Loader2, Inbox, AlertTriangle } from 'lucide-react';

/** Inline loading spinner + label. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--mn-muted)', padding: 16 }}>
      <Loader2 size={18} className="mn-spin" />
      <span style={{ fontSize: 14 }}>{label}</span>
    </div>
  );
}

/** Skeleton placeholder block. */
export function Skeleton({ width = '100%', height = 16, radius }: { width?: number | string; height?: number; radius?: number }) {
  return <div className="mn-skel" style={{ width, height, borderRadius: radius }} />;
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
      <AlertTriangle size={18} />
      <span style={{ flex: 1 }}>{message}</span>
      {action}
    </div>
  );
}
