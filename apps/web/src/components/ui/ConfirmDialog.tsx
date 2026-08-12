'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * App-consistent confirmation + input dialogs, replacing window.confirm/prompt.
 * They are stylable, accessible (role=dialog, Escape/Enter, focus, backdrop),
 * and non-blocking. Use the imperative hook so call sites read almost like the
 * native calls they replace:
 *
 *   const { confirm, prompt } = useConfirm();
 *   if (!(await confirm({ message: 'Delete this?' , danger: true }))) return;
 *   const note = await prompt({ label: 'Reason', defaultValue: '' }); // null = cancelled
 */
export interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export interface PromptOpts {
  title?: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  type?: 'text' | 'number';
  confirmLabel?: string;
  /** When set, the prompt renders a <select> of these options instead of a text input. */
  options?: { value: string; label: string }[];
}

interface DialogApi {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useConfirm(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}

type State =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; value: string; resolve: (v: string | null) => void }
  | null;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ kind: 'confirm', opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) =>
        setState({ kind: 'prompt', opts, value: opts.defaultValue ?? opts.options?.[0]?.value ?? '', resolve }),
      ),
    [],
  );

  const settle = useCallback((result: boolean | string | null) => {
    setState((s) => {
      if (s) {
        if (s.kind === 'confirm') (s.resolve as (v: boolean) => void)(Boolean(result));
        else (s.resolve as (v: string | null) => void)(result as string | null);
      }
      return null;
    });
  }, []);

  // Escape cancels, Enter accepts (for confirm; prompt uses the form submit).
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(state.kind === 'prompt' ? null : false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, settle]);

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {state && (
        <div
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(state.kind === 'prompt' ? null : false);
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,15,25,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={state.opts.title ?? (state.kind === 'confirm' ? 'Confirm' : 'Enter a value')}
            style={{
              background: 'var(--mn-surface, #fff)', color: 'var(--mn-text, #1e1e2e)',
              borderRadius: 12, padding: 20, width: 'min(440px, 100%)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            {state.opts.title && (
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px' }}>{state.opts.title}</h2>
            )}
            {state.kind === 'confirm' ? (
              <>
                <p style={{ margin: '0 0 18px', whiteSpace: 'pre-line', color: 'var(--mn-muted)' }}>
                  {state.opts.message}
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <Button variant="secondary" onClick={() => settle(false)}>
                    {state.opts.cancelLabel ?? 'Cancel'}
                  </Button>
                  <Button
                    variant={state.opts.danger ? 'danger' : 'primary'}
                    onClick={() => settle(true)}
                  >
                    {state.opts.confirmLabel ?? 'Confirm'}
                  </Button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  settle(state.value);
                }}
              >
                {state.opts.message && (
                  <p style={{ margin: '0 0 10px', color: 'var(--mn-muted)' }}>{state.opts.message}</p>
                )}
                {state.opts.label && (
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>{state.opts.label}</label>
                )}
                {state.opts.options ? (
                  <select
                    autoFocus
                    value={state.value}
                    onChange={(e) => setState((s) => (s && s.kind === 'prompt' ? { ...s, value: e.target.value } : s))}
                    className="mn-input"
                    style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--mn-border, #d9d9e3)' }}
                  >
                    {state.opts.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    autoFocus
                    type={state.opts.type === 'number' ? 'number' : 'text'}
                    value={state.value}
                    placeholder={state.opts.placeholder}
                    onChange={(e) => setState((s) => (s && s.kind === 'prompt' ? { ...s, value: e.target.value } : s))}
                    className="mn-input"
                    style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--mn-border, #d9d9e3)' }}
                  />
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                  <Button type="button" variant="secondary" onClick={() => settle(null)}>Cancel</Button>
                  <Button type="submit">{state.opts.confirmLabel ?? 'OK'}</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
