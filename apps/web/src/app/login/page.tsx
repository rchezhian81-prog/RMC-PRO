'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, BLOCKED_REASON_KEY } from '../../lib/api';
import { saveSession } from '../../lib/session';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { AlertSurface } from '../../components/ui/AlertSurface';
import { AuthFrame } from '../../components/AuthFrame';

/**
 * Sign in — one form for every kind of user. The server decides who you are:
 * a platform super admin lands on the tenants list, everyone else on their
 * company's workspace. A password an administrator typed for you sends you
 * to choose your own first. The password box shows what is typed on request
 * and warns when Caps Lock is on; a forgotten password has its own screen.
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
      const r = await api.login(login.trim(), password);
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
        mustChangePassword: Boolean(r.mustChangePassword),
      });
      const admin = r.user.userType === 'super_admin';
      if (r.mustChangePassword) router.push(admin ? '/admin/account?required=1' : '/app/account?required=1');
      else router.push(admin ? '/admin/tenants' : '/app');
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
        <PasswordInput
          id="mn-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      <div className="mn-login-row">
        <Link href="/forgot-password" className="mn-login-link">Forgotten your password?</Link>
      </div>
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
  return (
    <AuthFrame
      title="Welcome back"
      sub="Sign in to your Mix Nova workspace."
      help={<>Sign in with the email your company administrator gave you. <Link href="/" className="mn-login-help-link">Back to the home page</Link></>}
    >
      <LoginForm />
    </AuthFrame>
  );
}
