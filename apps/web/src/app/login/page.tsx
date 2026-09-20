'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, BLOCKED_REASON_KEY } from '../../lib/api';
import { saveSession } from '../../lib/session';
import { Logo } from '../../components/ui/Logo';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { AlertSurface } from '../../components/ui/AlertSurface';
import { isUiV2 } from '../../lib/ui-flag';
import { Aurora } from '../../components/Aurora';

/**
 * Functional login (Design Doc 5 §3) wired to the live API — Mix Nova branded.
 *
 * One form, two frames: the default is a centred card with the Nova-gradient
 * brand header; under the UI V2 flag it becomes the split-screen hero + panel.
 * Both build on the shared primitives (Field, Input, Button, AlertSurface), so
 * the sign-in controls look and behave exactly like every other form in the
 * app: the same focus ring, the same busy spinner, the same error surface.
 */
function useLogin() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If we were signed out because the company was blocked, say so — otherwise
  // arriving back at a blank sign-in form looks like the session simply expired,
  // and the operator retypes a password that was never the problem.
  useEffect(() => {
    const reason = window.sessionStorage.getItem(BLOCKED_REASON_KEY);
    if (!reason) return;
    window.sessionStorage.removeItem(BLOCKED_REASON_KEY);
    setError(reason);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(login, password);
      // Only the short-lived access token is kept in the browser. The refresh
      // token arrived as an httpOnly cookie (set by the login call above) and is
      // never touched by JavaScript.
      saveSession({
        token: r.access_token,
        userType: r.user.userType,
        email: r.user.email,
        permissions: r.permissions,
        roles: r.roles,
        modules: r.modules,
      });
      router.push(r.user.userType === 'super_admin' ? '/admin/tenants' : '/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return { login, setLogin, password, setPassword, error, busy, onSubmit };
}

function LoginForm() {
  const { login, setLogin, password, setPassword, error, busy, onSubmit } = useLogin();
  return (
    <form onSubmit={onSubmit} className="mn-login-form">
      <Field label="Email, mobile or user ID">
        <Input
          id="mn-login"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
        />
      </Field>
      <Field label="Password">
        <Input
          id="mn-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      {error && (
        <div className="mn-login-error">
          <AlertSurface tone="danger">{error}</AlertSurface>
        </div>
      )}
      <Button type="submit" loading={busy} style={{ width: '100%' }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  // V2: premium split-screen — violet brand hero + clean sign-in panel.
  if (isUiV2()) {
    return (
      <main className="mn-app mn-login-v2">
        <aside className="mn-login-hero">
          <Aurora watermark />
          <Link href="/" aria-label="Mix Nova home" className="mn-login-home">
            <Logo size="lg" plate />
          </Link>
          <h2 className="mn-login-hero-title">Smart Mix. Stronger Future.</h2>
          <p className="mn-login-hero-sub">
            The operating system for your ready-mix concrete plant — sales, production, dispatch and
            billing, all in one place.
          </p>
        </aside>
        <div className="mn-login-panel">
          <div className="mn-login-card">
            <h1 className="mn-login-title mn-login-title-lg">Welcome back</h1>
            <p className="mn-login-sub">Sign in to your Mix Nova workspace.</p>
            <LoginForm />
            <p className="mn-login-help">Forgotten your password? Ask your company admin to reset it.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mn-app mn-login">
      <Aurora watermark />
      <div className="mn-login-stack">
        <section className="mn-login-box">
          {/* Nova-gradient brand header */}
          <div className="mn-gradient mn-login-brand">
            <Link href="/" aria-label="Mix Nova home" className="mn-login-home">
              <Logo size="lg" showTagline onDark />
            </Link>
          </div>
          <div className="mn-login-body">
            <h1 className="mn-login-title">Sign in</h1>
            <p className="mn-login-sub">Your plant workspace — orders, batching, dispatch and billing.</p>
            <LoginForm />
          </div>
        </section>
        <p className="mn-login-help">
          Forgotten your password? Ask your company admin to reset it.
          <Link href="/" className="mn-login-help-link">Back to the home page</Link>
        </p>
      </div>
    </main>
  );
}
