'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, passwordProblems } from '@rmc/shared';
import { api } from '../../../lib/api';
import { getAccess, getSession } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState } from '../../../components/ui/States';

/**
 * My account — who you are signed in as, and your password.
 *
 * The header names the account with its roles as badges. The main card
 * changes the password with a live checklist (long enough, has a letter,
 * has a number, the two match) judged by the same rule the server uses;
 * the side card lists the roles and what to do if the password is
 * forgotten. Same layout in both skins; every colour reads the semantic
 * tokens.
 */

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };
const roleLabel = (r: string) => r.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function AccountPage() {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState<{ email: string; roles: string[]; permissions: number; userType: string } | null>(null);

  useEffect(() => {
    const s = getSession();
    if (s) setWho({ email: s.email, roles: s.roles ?? [], permissions: s.permissions?.length ?? 0, userType: s.userType });
  }, []);

  // Judged by the same rule the server uses, so the guidance never disagrees
  // with the eventual answer.
  const problems = form.newPassword ? passwordProblems(form.newPassword) : [];
  const mismatch = Boolean(form.confirmPassword) && form.newPassword !== form.confirmPassword;
  const checks = [
    { ok: form.newPassword.length >= PASSWORD_MIN_LENGTH, label: `At least ${PASSWORD_MIN_LENGTH} characters` },
    { ok: /[a-z]/i.test(form.newPassword), label: 'Has a letter' },
    { ok: /\d/.test(form.newPassword), label: 'Has a number' },
    { ok: Boolean(form.confirmPassword) && !mismatch, label: 'Typed the same twice' },
  ];
  const ready = form.currentPassword && form.newPassword && problems.length === 0 && form.confirmPassword && !mismatch;
  const canManageUsers = getAccess().has('users.manage');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (mismatch) { setError('The two new passwords do not match.'); return; }
    if (problems.length) { setError(`The password must ${problems.join(', ')}.`); return; }
    setBusy(true);
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      setForm(EMPTY);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mn-od mn-ac">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <h1>
            My account
            <span className="mn-od-badges">
              {who?.roles.map((r) => <Badge key={r} tone={r === 'company_owner' ? 'info' : 'neutral'}>{roleLabel(r)}</Badge>)}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who"><UserCog size={13} aria-hidden /> {who ? who.email : 'Signed in'}</span>
            {who && <span className="mn-od-fact"><ShieldCheck size={13} aria-hidden /> {who.roles.includes('company_owner') || who.userType === 'super_admin' ? 'Full access to every screen' : `${who.permissions} ${who.permissions === 1 ? 'permission' : 'permissions'} through your roles`}</span>}
          </p>
        </div>
      </header>

      {done && (
        <div className="mn-ord-note mn-ord-note--ok" role="status">
          <CheckCircle2 size={16} aria-hidden />
          <span><strong>Password changed.</strong> Use the new one the next time you sign in; the current session stays signed in.</span>
        </div>
      )}
      {error && <ErrorState message={error} />}

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><KeyRound size={16} aria-hidden /> Change password</span>}>
            <Form onSubmit={submit} className="mn-ac-form">
              <div className="mn-ac-fields">
                <Field label="Current password" required>
                  <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
                </Field>
                <Field label="New password" required error={form.newPassword && problems.length ? `Must ${problems.join(', ')}.` : undefined}>
                  <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
                </Field>
                <Field label="New password again" required error={mismatch ? 'The two passwords do not match.' : undefined}>
                  <Input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
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
        </div>
        <div className="mn-od-side">
          <Card title={<span className="mn-board-card-title"><ShieldCheck size={16} aria-hidden /> Your access</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Signed in as</dt><dd>{who?.email ?? '—'}</dd></div>
              <div><dt>Roles</dt><dd>{who?.roles.length ? who.roles.map(roleLabel).join(', ') : 'None'}</dd></div>
              <div><dt>Screens</dt><dd>{who ? (who.roles.includes('company_owner') || who.userType === 'super_admin' ? 'All' : `${who.permissions} permissions`) : '—'}</dd></div>
            </dl>
            <p className="mn-od-how mn-od-how--foot">Roles decide which screens you see and what you can do on them. {canManageUsers ? <>Change them under <Link href="/app/users" prefetch={false} className="mn-id-link">Users</Link>.</> : 'Ask an administrator to change them.'}</p>
          </Card>
          <Card title={<span className="mn-board-card-title"><KeyRound size={16} aria-hidden /> Forgotten password</span>}>
            <p className="mn-od-notes">If you cannot sign in, an administrator sets a new password for you from Setup → Users. There is no reset link by email or WhatsApp.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
