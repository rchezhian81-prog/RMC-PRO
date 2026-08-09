import type { CSSProperties } from 'react';

/**
 * Shared inline-style primitives used by the Phase-1 screens. In Phase B these
 * were re-pointed from hardcoded dark hex onto Mix Nova tokens, so every screen
 * that uses them follows the light (and dark-toggle) theme. Per-screen polish
 * with the components/ui kit still follows in Phases C–E.
 */
export const card: CSSProperties = {
  background: 'var(--mn-surface)',
  border: '1px solid var(--mn-border)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 20,
  boxShadow: 'var(--mn-shadow-card)',
};

export const input: CSSProperties = {
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid var(--mn-border-strong)',
  background: 'var(--mn-surface)',
  color: 'var(--mn-text)',
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
  border: '1px solid var(--mn-border-strong)',
  background: 'transparent',
  color: 'var(--mn-text)',
  fontSize: 13,
  cursor: 'pointer',
};

export const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
export const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  color: 'var(--mn-muted)',
  borderBottom: '1px solid var(--mn-border)',
  fontWeight: 600,
};
export const td: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--mn-border)' };
