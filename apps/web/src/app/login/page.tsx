'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { saveSession } from '../../lib/session';
import { Logo } from '../../components/ui/Logo';

/** Functional login (Design Doc 5 §3) wired to the live API — Mix Nova branded. */
export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(login, password);
      saveSession({
        token: r.access_token,
        refreshToken: r.refresh_token,
        userType: r.user.userType,
        email: r.user.email,
      });
      router.push(r.user.userType === 'super_admin' ? '/admin/tenants' : '/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  const field: CSSProperties = {
    padding: '11px 13px',
    borderRadius: 'var(--mn-radius-md)',
    border: '1px solid var(--mn-border-strong)',
    background: 'var(--mn-surface)',
    color: 'var(--mn-text)',
    fontSize: 14,
    width: '100%',
    margin: '6px 0 16px',
  };
  const label: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--mn-muted)' };

  return (
    <main
      className="mn-app"
      style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr', placeItems: 'center', padding: 24 }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--mn-surface)',
          border: '1px solid var(--mn-border)',
          borderRadius: 'var(--mn-radius-lg)',
          boxShadow: 'var(--mn-shadow-card)',
          overflow: 'hidden',
        }}
      >
        {/* Nova-gradient brand header */}
        <div className="mn-gradient" style={{ padding: '26px 28px 22px' }}>
          <Logo size="lg" showTagline onDark />
        </div>

        <div style={{ padding: 28 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 20, color: 'var(--mn-text)' }}>Sign in</h1>
          <p style={{ margin: '0 0 20px', color: 'var(--mn-muted)', fontSize: 14 }}>
            Mix Nova RMC Software — plant operating system
          </p>
          <form onSubmit={onSubmit}>
            <label htmlFor="mn-login" style={label}>
              Email / Mobile / User ID
            </label>
            <input
              id="mn-login"
              style={field}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              aria-label="login-identifier"
              required
            />
            <label htmlFor="mn-password" style={label}>
              Password
            </label>
            <input
              id="mn-password"
              style={field}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              aria-label="password"
              required
            />
            {error && (
              <p
                role="alert"
                style={{
                  color: 'var(--mn-danger)',
                  background: 'var(--mn-danger-tint)',
                  border: '1px solid var(--mn-danger)',
                  borderRadius: 'var(--mn-radius-sm)',
                  padding: '8px 10px',
                  fontSize: 13,
                  margin: '0 0 14px',
                }}
              >
                {error}
              </p>
            )}
            <button
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 'var(--mn-radius-md)',
                border: 'none',
                background: 'var(--mn-primary)',
                color: 'var(--mn-on-primary)',
                fontWeight: 600,
                fontSize: 14,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.65 : 1,
              }}
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
