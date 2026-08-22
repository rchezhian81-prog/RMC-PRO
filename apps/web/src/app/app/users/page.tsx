'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, KeyRound, UserCheck, UserX } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, passwordProblems } from '@rmc/shared';
import { planUsageApi, rolesApi, usersApi, type PlanUsage, type Row } from '../../../lib/api';
import { getSession } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input, Select } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

const EMPTY = { name: '', email: '', password: '', mobile: '', roleId: '' };

export default function UsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    const [u, r] = await Promise.all([usersApi.list(), rolesApi.list()]);
    setRows(u);
    setRoles(r);
    // Seats are refreshed alongside the list, so deactivating someone visibly
    // frees one. A failure here must not blank the page — the count is guidance,
    // the server is what actually decides.
    planUsageApi.get().then(setUsage).catch(() => setUsage(null));
  }

  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await usersApi.create(form);
      setForm(EMPTY);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the user.');
    } finally {
      setBusy(false);
    }
  }

  /** Change a user's role in place — the list reflects the new access at once. */
  async function changeRole(id: string, roleId: string) {
    setError(null);
    setSavingId(id);
    try {
      await usersApi.update(id, { roleId });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the role.');
    } finally {
      setSavingId(null);
    }
  }

  /** Turn a login on or off without deleting the person's history. */
  async function toggleActive(u: Row) {
    const active = String(u.status ?? '') === 'active';
    const label = String(u.name ?? u.email ?? 'this user');
    if (active && !confirm(`Deactivate ${label}? They will not be able to sign in until reactivated.`)) return;
    setError(null);
    setSavingId(String(u.id));
    try {
      await usersApi.update(String(u.id), { status: active ? 'inactive' : 'active' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status.');
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Set a new password for someone who has forgotten theirs. Judged by the same
   * rule the server uses, so the prompt cannot accept what the API will reject.
   */
  async function resetPassword(u: Row) {
    const label = String(u.name ?? u.email ?? 'this user');
    const pw = prompt(
      `New password for ${label}\n\nAt least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.\nTell them the password yourself — it is not shown again.`,
    );
    if (pw === null) return;
    const problems = passwordProblems(pw);
    if (problems.length) {
      setError(`That password must ${problems.join(', ')}. Nothing was changed.`);
      return;
    }
    setError(null);
    setSavingId(String(u.id));
    try {
      await usersApi.update(String(u.id), { password: pw });
      setNotice(`Password updated for ${label}. Give it to them directly — it is not stored anywhere you can read.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password.');
    } finally {
      setSavingId(null);
    }
  }

  const noRole = rows.filter((r) => !r.roleId && r.userType !== 'super_admin').length;
  const myId = getSession()?.email;
  // A null limit means no plan is assigned, so nothing is capped.
  const seatLimit = usage?.users.limit ?? null;
  const seatsFull = seatLimit !== null && (usage?.users.used ?? 0) >= seatLimit;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Users</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>
        A user can only see and do what their role allows. Give every person the role that matches their job.
      </p>

      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      {notice && (
        <div
          style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 'var(--mn-radius-md)',
            background: 'var(--mn-success-tint)', color: 'var(--mn-success)', fontSize: 13,
            display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
          >
            ×
          </button>
        </div>
      )}

      {noRole > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ErrorState
            message={`${noRole} user${noRole > 1 ? 's have' : ' has'} no role, so they cannot use the app at all. Assign a role below.`}
          />
        </div>
      )}

      {seatsFull && (
        <div style={{ marginBottom: 14 }}>
          <ErrorState
            message={`All ${seatLimit} user${seatLimit === 1 ? '' : 's'} on your ${usage?.planName ?? 'current'} plan are in use. Deactivate someone who has left to free a place, or contact Mix Nova to add more.`}
          />
        </div>
      )}

      <div className="mn-crud">
        <div className="mn-crud-aside">
        <Card
          title={
            seatLimit === null
              ? 'New user'
              : `New user — ${usage?.users.used ?? 0} of ${seatLimit} in use`
          }
        >
          <Form onSubmit={create} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ minWidth: 170 }}>
              <Field label="Name" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
            </div>
            <div style={{ minWidth: 210 }}>
              <Field label="Email" required>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Mobile">
                <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Password" required>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </Field>
            </div>
            <div style={{ minWidth: 190 }}>
              <Field label="Role" required help="Decides what they can open">
                <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} required>
                  <option value="">Select a role…</option>
                  {roles.map((r) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {String(r.roleName ?? r.roleKey ?? '')}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button
                type="submit"
                loading={busy}
                disabled={seatsFull}
                title={seatsFull ? 'No places left on your plan' : undefined}
              >
                Create
              </Button>
            </div>
          </Form>
        </Card>
        </div>
        <div className="mn-crud-main">
      <Card title="Users" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSuper = r.userType === 'super_admin';
                return (
                  <tr key={String(r.id)}>
                    <Td style={{ fontWeight: 600 }}>{String(r.name ?? '')}</Td>
                    <Td>{String(r.email ?? '')}</Td>
                    <Td>
                      {isSuper ? (
                        <Badge tone="info">Platform admin</Badge>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Select
                            value={String(r.roleId ?? '')}
                            disabled={savingId === String(r.id)}
                            onChange={(e) => changeRole(String(r.id), e.target.value)}
                            style={{ minWidth: 180 }}
                            aria-label={`Role for ${String(r.name ?? '')}`}
                          >
                            <option value="">— no role —</option>
                            {roles.map((role) => (
                              <option key={String(role.id)} value={String(role.id)}>
                                {String(role.roleName ?? role.roleKey ?? '')}
                              </option>
                            ))}
                          </Select>
                          {!r.roleId && (
                            <span
                              title="No role: this user cannot use the app"
                              style={{ display: 'inline-flex', color: 'var(--mn-danger)' }}
                            >
                              <AlertTriangle size={16} />
                            </span>
                          )}
                        </div>
                      )}
                    </Td>
                    <Td><StatusBadge status={String(r.status ?? '')} /></Td>
                    <Td>
                      {!isSuper && (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<KeyRound size={14} />}
                            disabled={savingId === String(r.id)}
                            onClick={() => resetPassword(r)}
                            title="Set a new password for this person"
                          >
                            Password
                          </Button>
                          {String(r.email ?? '') !== myId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={
                                String(r.status ?? '') === 'active' ? <UserX size={14} /> : <UserCheck size={14} />
                              }
                              disabled={savingId === String(r.id)}
                              onClick={() => toggleActive(r)}
                              title={
                                String(r.status ?? '') === 'active'
                                  ? 'Stop this person signing in'
                                  : 'Let this person sign in again'
                              }
                            >
                              {String(r.status ?? '') === 'active' ? 'Deactivate' : 'Activate'}
                            </Button>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No users yet" description="Add your first user above." />
        )}
      </Card>
        </div>
      </div>

      <p style={{ color: 'var(--mn-subtle)', fontSize: 12, marginTop: 12 }}>
        Changing a role takes effect on the person&apos;s next sign-in. To fine-tune what a role can do, go to
        Setup&nbsp;→&nbsp;Roles.
      </p>
    </div>
  );
}
