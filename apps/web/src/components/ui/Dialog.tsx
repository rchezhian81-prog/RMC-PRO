'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Generic modal surface — the reusable command dialog the app's confirm/prompt
 * and future forms build on. Escape closes; backdrop click closes; focus moves
 * into the panel and restores on close. Pop-in collapses under reduced-motion.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prevFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="mn-modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="mn-modal"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : ariaLabel ?? 'Dialog'}
        tabIndex={-1}
      >
        {title && (
          <div className="mn-modal-head">
            {typeof title === 'string' ? <h2 className="mn-modal-title">{title}</h2> : title}
          </div>
        )}
        <div className="mn-modal-body">{children}</div>
        {footer && <div className="mn-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
