'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keep Tab / Shift+Tab focus inside `ref` while `active`. Pairs with the modal's
 * own Escape-to-close and focus-restore — this only stops focus escaping to the
 * page behind an `aria-modal` surface, which is the WCAG "no keyboard trap"
 * counterpart for dialogs (focus must not leak out of a modal).
 *
 * Presentation only: it moves focus, it never changes what any control does.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // Only the currently visible, enabled controls take part.
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) {
        // Nothing focusable inside — keep focus on the panel itself.
        e.preventDefault();
        root.focus();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      const inside = current ? root.contains(current) : false;
      if (e.shiftKey) {
        if (!inside || current === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref, active]);
}
