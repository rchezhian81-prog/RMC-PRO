import type { CSSProperties } from 'react';

/**
 * Login placeholder (Design Doc 5 §3). Wired to the auth API in Sprint 1 (F1).
 * This is a static skeleton screen — no auth logic yet.
 */
export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--panel)',
          borderRadius: 16,
          padding: 28,
          boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
        }}
      >
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>🏗️ RMC Pro</h1>
        <p style={{ margin: '0 0 20px', color: 'var(--muted)', fontSize: 14 }}>
          Plant SaaS — sign in
        </p>

        <form>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            Email / Mobile / User ID
          </label>
          <input
            type="text"
            disabled
            placeholder="you@company.com"
            style={inputStyle}
            aria-label="login-identifier"
          />

          <label style={{ display: 'block', fontSize: 13, margin: '14px 0 6px' }}>Password</label>
          <input
            type="password"
            disabled
            placeholder="••••••••"
            style={inputStyle}
            aria-label="password"
          />

          <button type="button" disabled style={buttonStyle}>
            Login (wired in Sprint 1)
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }}>
          Skeleton screen — authentication lands with the multi-tenant foundation.
        </p>
      </section>
    </main>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #26314b',
  background: '#0e1626',
  color: 'var(--text)',
  fontSize: 14,
};

const buttonStyle: CSSProperties = {
  width: '100%',
  marginTop: 20,
  padding: '11px 12px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--brand)',
  color: '#1a1205',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'not-allowed',
  opacity: 0.85,
};
