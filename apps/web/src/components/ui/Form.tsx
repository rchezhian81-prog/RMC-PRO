'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormHTMLAttributes,
  type ReactNode,
} from 'react';

/** The event type React hands to a form's onSubmit (it carries `submitter`). */
type SubmitHandler = NonNullable<FormHTMLAttributes<HTMLFormElement>['onSubmit']>;
type SubmitArg = Parameters<SubmitHandler>[0];

/** True while the enclosing Form's submit handler is still running. */
export const FormBusyContext = createContext(false);

export const useFormBusy = (): boolean => useContext(FormBusyContext);

/**
 * A `<form>` that knows when it is saving.
 *
 * If `onSubmit` returns a promise, the form blocks repeat submissions until it
 * settles and publishes a busy flag that submit buttons pick up automatically —
 * so a slow save shows a spinner instead of looking like nothing happened.
 *
 * Drop-in for `<form>`: same props, same children.
 */
export function Form({
  onSubmit,
  children,
  ...rest
}: { children: ReactNode } & FormHTMLAttributes<HTMLFormElement>) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const handle = useCallback(
    (e: SubmitArg) => {
      // Enter-key submits can arrive while a save is already running.
      if (busy) {
        e.preventDefault();
        return;
      }
      const result = onSubmit?.(e) as unknown;
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        setBusy(true);
        void (result as Promise<unknown>).finally(() => {
          if (alive.current) setBusy(false);
        });
      }
    },
    [onSubmit, busy],
  );

  return (
    <FormBusyContext.Provider value={busy}>
      <form onSubmit={handle} aria-busy={busy || undefined} {...rest}>
        {children}
      </form>
    </FormBusyContext.Provider>
  );
}
