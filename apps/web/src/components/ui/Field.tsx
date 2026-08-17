import {
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

/**
 * Labelled form field with optional help/error text.
 *
 * The label is programmatically tied to its control: when `children` is a single
 * element without its own `id`, we generate one and point `htmlFor` at it (and
 * wire `aria-describedby` to the help/error text). Callers can still pass an
 * explicit `htmlFor` + matching `id` to opt out. This is presentation/semantics
 * only — no control's value or behaviour changes.
 */
export function Field({
  label,
  help,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const descId = useId();

  let control = children;
  let forId = htmlFor;

  // Auto-associate only for a single element the caller didn't pre-wire.
  if (!forId && isValidElement(children)) {
    const child = children as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
    const existingId = child.props.id;
    forId = existingId ?? autoId;
    const patch: { id?: string; 'aria-describedby'?: string } = {};
    if (!existingId) patch.id = forId;
    if ((error || help) && !child.props['aria-describedby']) patch['aria-describedby'] = descId;
    if (Object.keys(patch).length) control = cloneElement(child, patch);
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label
        htmlFor={forId}
        style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--mn-muted)', marginBottom: 6 }}
      >
        {label}
        {required && <span style={{ color: 'var(--mn-danger)' }}> *</span>}
      </label>
      {control}
      {error ? (
        <div id={descId} style={{ fontSize: 12, color: 'var(--mn-danger)', marginTop: 5 }}>{error}</div>
      ) : help ? (
        <div id={descId} style={{ fontSize: 12, color: 'var(--mn-subtle)', marginTop: 5 }}>{help}</div>
      ) : null}
    </div>
  );
}

/** Mix Nova text input. */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`mn-input ${className}`.trim()} {...rest} />;
}

/** Mix Nova dropdown — same surface treatment as Input. */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <select className={`mn-input ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}
