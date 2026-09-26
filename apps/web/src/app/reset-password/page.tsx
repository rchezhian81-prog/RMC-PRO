'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Circle, KeyRound } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, passwordProblems } from '@rmc/shared';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { AlertSurface } from '../../components/ui/AlertSurface';
import { AuthFrame } from '../../components/AuthFrame';

/**
 * Choose a new password from the link in the email. The token in the address
 * is sent with the new password; the server checks it is the one it issued,
 * unused and under 30 minutes old. The rules are checked live, by the same
 * rule the server applies, so the form never disagrees with the answer.
 */
function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const problems = pw ? passwordProblems(pw) : [];
  const mismatch = Boolean(again) && pw !== again;
  const checks = [
    { ok: pw.length >= PASSWORD_MIN_LENGTH, label: `At least ${PASSWORD_MIN_LENGTH} characters` },
    { ok: /[a-z]/i.test(pw), label: 'Has a letter' },
    { ok: /\d/.test(pw), label: 'Has a number' },
    { ok: Boolean(again) && !mismatch, label: 'Typed the same twice' },
  ];
  const ready = token && pw && problems.length === 0 && again && !mismatch;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.resetPassword(token, pw);
      setDone(r.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthFrame title="This link is incomplete" sub="Open the link from the email again, or ask for a new one." help={<Link href="/forgot-password" className="mn-login-link">Ask for a new link</Link>}>
        <div className="mn-login-done"><KeyRound size={22} aria-hidden /><p>The address is missing its reset code. Copy the whole link from the email into the browser.</p></div>
      </AuthFrame>
    );
  }

  if (done) {
    return (
      <AuthFrame title="Password changed" sub={`Sign in as ${done} with your new password.`}>
        <div className="mn-login-done" role="status">
          <CheckCircle2 size={22} aria-hidden />
          <p>Every other session on this login has been signed out.</p>
        </div>
        <Link href="/login" className="mn-btn mn-btn-primary mn-login-cta">Sign in</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Choose a new password" sub="Pick one you will remember. A short sentence beats a word with a number stuck on the end." help={<Link href="/login" className="mn-login-link">Back to sign in</Link>}>
      <form onSubmit={onSubmit} className="mn-login-form">
        <Field label="New password" error={pw && problems.length ? `Must ${problems.join(', ')}.` : undefined}>
          <PasswordInput id="mn-reset-pw" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus required />
        </Field>
        <Field label="New password again" error={mismatch ? 'The two passwords do not match.' : undefined}>
          <PasswordInput id="mn-reset-again" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </Field>
        <ul className="mn-ac-rules mn-login-rules" aria-label="Password rules">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? 'is-ok' : ''}>
              {c.ok ? <CheckCircle2 size={15} aria-hidden /> : <Circle size={15} aria-hidden />}
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
        {error && (
          <div className="mn-login-error">
            <AlertSurface tone="danger">{error}</AlertSurface>
          </div>
        )}
        <Button type="submit" loading={busy} disabled={!ready} style={{ width: '100%' }}>
          {busy ? 'Saving…' : 'Set the new password'}
        </Button>
      </form>
    </AuthFrame>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
