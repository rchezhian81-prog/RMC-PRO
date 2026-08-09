'use client';

import { useEffect, useState } from 'react';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, passwordProblems } from '@rmc/shared';
import { api } from '../../../lib/api';
import { getSession } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState } from '../../../components/ui/States';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function AccountPage() {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [who, setWho] = useState<{ email: string; roles: string[] } | null>(null);

  useEffect(() => {
    const s = getSession();
    if (s) setWho({ email: s.email, roles: s.roles ?? [] });
  }, []);

  // Judged by the same rule the server uses, so the guidance never disagrees
  // with the eventual answer.
  const problems = form.newPassword ? passwordProblems(form.newPassword) : [];
  const mismatch = Boolean(form.confirmPassword) && form.newPassword !== form.confirmPassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (mismatch) {
      setError('The two new passwords do not match.');
      return;
    }
    if (problems.length) {
      setError(`The password must ${problems.join(', ')}.`);
      return;
    }
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      setForm(EMPTY);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>My account</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>
        {who ? (
          <>
            Signed in as <strong>{who.email}</strong>
            {who.roles.length ? ` · ${who.roles.map((r) => r.replace(/_/g, ' ')).join(', ')}` : ''}
          </>
        ) : (
          'Signed in'
        )}
      </p>

      <Card
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={16} color="var(--mn-primary)" /> Change password
          </span>
        }
      >
        {done && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
              padding: '10px 12px', borderRadius: 'var(--mn-radius-md)',
              background: 'var(--mn-success-tint)', color: 'var(--mn-success)', fontSize: 13,
            }}
          >
            <CheckCircle2 size={16} /> Password changed. Use the new one next time you sign in.
          </div>
        )}
        {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

        <Form onSubmit={submit}>
          <Field label="Current password" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required
            />
          </Field>
          <Field
            label="New password"
            required
            help={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
            error={form.newPassword && problems.length ? `Must ${problems.join(', ')}.` : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              required
            />
          </Field>
          <Field
            label="Confirm new password"
            required
            error={mismatch ? 'The two passwords do not match.' : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              required
            />
          </Field>
          <Button type="submit" disabled={problems.length > 0 || mismatch}>
            Change password
          </Button>
        </Form>
      </Card>

      <p style={{ color: 'var(--mn-subtle)', fontSize: 12, marginTop: 12 }}>
        Forgotten your password? Ask your administrator to set a new one from Setup&nbsp;→&nbsp;Users.
      </p>
    </div>
  );
}
