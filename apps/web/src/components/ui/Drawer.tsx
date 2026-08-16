'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../lib/use-focus-trap';

/**
 * Right-side command drawer. Escape closes; a backdrop click closes; focus moves
 * into the panel on open, is trapped while open, and is restored to the trigger
 * on close. Slide-in collapses under prefers-reduced-motion. Full-width on phones.
 */
export function Drawer({
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
  const panelRef = useRef<HTMLElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  useFocusTrap(panelRef, open);

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
      className="mn-drawer-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="mn-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : ariaLabel ?? 'Panel'}
        tabIndex={-1}
      >
        <div className="mn-drawer-head">
          {typeof title === 'string' ? <h2 className="mn-drawer-title">{title}</h2> : title}
          <button className="mn-iconbtn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="mn-drawer-body">{children}</div>
        {footer && <div className="mn-drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}
