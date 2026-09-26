'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, KeyRound } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, passwordProblems } from '@rmc/shared';
import { api } from '../lib/api';
import { clearMustChangePassword } from '../lib/session';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Form } from './ui/Form';
import { Field } from './ui/Field';
import { PasswordInput } from './ui/PasswordInput';
import { ErrorState } from './ui/States';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * Change your own password, with a live checklist judged by the same rule the
 * server uses. Shared by the company workspace (My account) and the platform
 * portal (the super admin's account), so both behave the same. `required` is
 * the first sign-in after an administrator typed the password: the wording
 * says why the screen opened on its own.
 */
export function ChangePasswordCard({ required = false, onChanged }: { required?: boolean; onChanged?: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const problems = form.newPassword ? passwordProblems(form.newPassword) : [];
  const mismatch = Boolean(form.confirmPassword) && form.newPassword !== form.confirmPassword;
  const checks = [
    { ok: form.newPassword.length >= PASSWORD_MIN_LENGTH, label: `At least ${PASSWORD_MIN_LENGTH} characters` },
    { ok: /[a-z]/i.test(form.newPassword), label: 'Has a letter' },
    { ok: /\d/.test(form.newPassword), label: 'Has a number' },
    { ok: Boolean(form.confirmPassword) && !mismatch, label: 'Typed the same twice' },
  ];
  const ready = form.currentPassword && form.newPassword && problems.length === 0 && form.confirmPassword && !mismatch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (mismatch) { setError('The two new passwords do not match.'); return; }
    if (problems.length) { setError(`The password must ${problems.join(', ')}.`); return; }
    setBusy(true);
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      clearMustChangePassword();
      setForm(EMPTY);
      setDone(true);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {done && (
        <div className="mn-ord-note mn-ord-note--ok" role="status">
          <CheckCircle2 size={16} aria-hidden />
          <span><strong>Password changed.</strong> Use the new one the next time you sign in; this session stays signed in, every other one is signed out.</span>
        </div>
      )}
      {required && !done && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <KeyRound size={16} aria-hidden />
          <span><strong>Choose your own password to continue.</strong> The one you signed in with was typed by an administrator. Enter it as the current password, then pick a new one only you know.</span>
        </div>
      )}
      {error && <ErrorState message={error} />}
      <Card title={<span className="mn-board-card-title"><KeyRound size={16} aria-hidden /> Change password</span>}>
        <Form onSubmit={submit} className="mn-ac-form">
          <div className="mn-ac-fields">
            <Field label="Current password" required>
              <PasswordInput autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required autoFocus={required} />
            </Field>
            <Field label="New password" required error={form.newPassword && problems.length ? `Must ${problems.join(', ')}.` : undefined}>
              <PasswordInput autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
            </Field>
            <Field label="New password again" required error={mismatch ? 'The two passwords do not match.' : undefined}>
              <PasswordInput autoComplete="new-password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
            </Field>
            <Button type="submit" disabled={!ready} loading={busy} icon={<KeyRound size={14} />}>Change the password</Button>
          </div>
          <ul className="mn-ac-rules" aria-label="Password rules">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? 'is-ok' : ''}>
                {c.ok ? <CheckCircle2 size={15} aria-hidden /> : <Circle size={15} aria-hidden />}
                <span>{c.label}</span>
              </li>
            ))}
            <li className="mn-ac-rules-foot">A short sentence you will remember beats a word with a number stuck on the end.</li>
          </ul>
        </Form>
      </Card>
    </>
  );
}
