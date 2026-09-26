'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { AlertSurface } from '../../components/ui/AlertSurface';
import { AuthFrame } from '../../components/AuthFrame';

/**
 * Forgotten password: type the email you sign in with and a reset link is
 * sent to it. The reply reads the same whether or not the address has an
 * account, so the form cannot be used to find out who is registered. When
 * the server has no mailbox set up, it says so and points at the
 * administrator, rather than promising an email that never comes.
 */
export default function ForgotPasswordPage() {
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ channel: 'email' | 'none'; minutes: number } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.forgotPassword(login.trim());
      setSent({ channel: r.channel, minutes: r.minutes });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link.');
    } finally {
      setBusy(false);
    }
  }

  if (sent?.channel === 'email') {
    return (
      <AuthFrame title="Check your email" sub={`If ${login.trim()} has a Mix Nova login, a reset link is on its way.`} help={<Link href="/login" className="mn-login-link">Back to sign in</Link>}>
        <div className="mn-login-done" role="status">
          <MailCheck size={22} aria-hidden />
          <p>The link works once and for {sent.minutes} minutes. If nothing arrives, check the spam folder, make sure this is the email you sign in with, and try again.</p>
        </div>
      </AuthFrame>
    );
  }

  if (sent?.channel === 'none') {
    return (
      <AuthFrame title="Ask your administrator" sub="Email reset is not switched on for this server yet." help={<Link href="/login" className="mn-login-link">Back to sign in</Link>}>
        <div className="mn-login-done" role="status">
          <MailCheck size={22} aria-hidden />
          <p>Your company administrator can set a new password for you under <strong>Setup → Users</strong>. If you are the company owner, contact Mix Nova support.</p>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Forgotten your password?"
      sub="Type the email you sign in with. We will send a link to choose a new one."
      help={<>Remembered it? <Link href="/login" className="mn-login-link">Back to sign in</Link></>}
    >
      <form onSubmit={onSubmit} className="mn-login-form">
        <Field label="Email">
          <Input
            id="mn-forgot-login"
            type="email"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
          />
        </Field>
        {error && (
          <div className="mn-login-error">
            <AlertSurface tone="danger">{error}</AlertSurface>
          </div>
        )}
        <Button type="submit" loading={busy} style={{ width: '100%' }}>
          {busy ? 'Sending…' : 'Send the reset link'}
        </Button>
      </form>
    </AuthFrame>
  );
}
