'use client';

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useFormBusy } from './Form';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Mix Nova button.
 *
 * If `onClick` returns a promise, the button manages its own busy state: it
 * shows a spinner and refuses further clicks until that promise settles. This
 * is what stops a second press creating a second document when a save is slow —
 * the case that actually matters on plant Wi-Fi, where nothing appears to
 * happen for a second or two and the natural reaction is to click again.
 *
 * Pass `loading` explicitly to drive the state yourself; that always wins.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  className = '',
  disabled,
  onClick,
  type,
  ...rest
}: {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [pending, setPending] = useState(false);
  // A click can unmount the button (dialog closes, row disappears). Don't
  // setState afterwards — React would warn and the state is meaningless.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (!onClick) return;
      // Guard the synchronous re-entry too: two clicks in the same tick would
      // otherwise both pass the `pending` check before React re-renders.
      if (pending) {
        e.preventDefault();
        return;
      }
      const result = onClick(e) as unknown;
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        setPending(true);
        void (result as Promise<unknown>).finally(() => {
          if (alive.current) setPending(false);
        });
      }
    },
    [onClick, pending],
  );

  // A submit button also reflects its form's save, since the work is driven by
  // the form's onSubmit rather than by this button's onClick.
  const formBusy = useFormBusy();
  const busy = loading ?? (pending || (type === 'submit' && formBusy));
  const cls = ['mn-btn', `mn-btn-${variant}`, size === 'sm' ? 'mn-btn-sm' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={cls}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={handleClick}
      {...rest}
    >
      {busy ? <Loader2 size={16} className="mn-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
