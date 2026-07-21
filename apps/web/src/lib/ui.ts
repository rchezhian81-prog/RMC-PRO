import type { CSSProperties } from 'react';

export const card: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid #26314b',
  borderRadius: 12,
  padding: 20,
  marginBottom: 20,
};

export const input: CSSProperties = {
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid #26314b',
  background: '#0e1626',
  color: 'var(--text)',
  fontSize: 14,
  width: '100%',
};

export const button: CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--brand)',
  color: 'var(--brand-contrast)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

export const ghostButton: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #26314b',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
};

export const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
export const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  color: 'var(--muted)',
  borderBottom: '1px solid #26314b',
  fontWeight: 600,
};
export const td: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1c2437' };
