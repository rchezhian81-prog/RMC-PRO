import type { InputHTMLAttributes, ReactNode } from 'react';

/** Labelled form field with optional help/error text. */
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
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        htmlFor={htmlFor}
        style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--mn-muted)', marginBottom: 6 }}
      >
        {label}
        {required && <span style={{ color: 'var(--mn-danger)' }}> *</span>}
      </label>
      {children}
      {error ? (
        <div style={{ fontSize: 12, color: 'var(--mn-danger)', marginTop: 5 }}>{error}</div>
      ) : help ? (
        <div style={{ fontSize: 12, color: 'var(--mn-subtle)', marginTop: 5 }}>{help}</div>
      ) : null}
    </div>
  );
}

/** Mix Nova text input. */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`mn-input ${className}`.trim()} {...rest} />;
}
