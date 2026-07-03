'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { saveSession } from '../../lib/session';
import { button, card, input } from '../../lib/ui';

/** Functional login (Design Doc 5 §3) wired to the live API. */
export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('super@platform.test');
  const [password, setPassword] = useState('Passw0rd!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(login, password);
      saveSession({ token: r.access_token, userType: r.user.userType, email: r.user.email });
      router.push(r.user.userType === 'super_admin' ? '/admin/tenants' : '/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ ...card, width: '100%', maxWidth: 380 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>🏗️ RMC Pro</h1>
        <p style={{ margin: '0 0 18px', color: 'var(--muted)', fontSize: 14 }}>
          Super Admin — sign in
        </p>
        <form onSubmit={onSubmit}>
          <label style={{ fontSize: 13 }}>Email / Mobile / User ID</label>
          <input
            style={{ ...input, margin: '6px 0 14px' }}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            aria-label="login-identifier"
          />
          <label style={{ fontSize: 13 }}>Password</label>
          <input
            style={{ ...input, margin: '6px 0 18px' }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="password"
          />
          {error && (
            <p style={{ color: '#ff8080', fontSize: 13, margin: '0 0 12px' }}>{error}</p>
          )}
          <button style={{ ...button, width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy}>
            {busy ? 'Signing in…' : 'Login'}
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)' }}>
          Demo: super@platform.test / Passw0rd!
        </p>
      </section>
    </main>
  );
}
