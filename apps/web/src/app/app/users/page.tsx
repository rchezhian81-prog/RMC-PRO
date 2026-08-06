'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { rolesApi, usersApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input, Select } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

const EMPTY = { name: '', email: '', password: '', mobile: '', roleId: '' };

export default function UsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [u, r] = await Promise.all([usersApi.list(), rolesApi.list()]);
    setRows(u);
    setRoles(r);
  }

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
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

  const noRole = rows.filter((r) => !r.roleId && r.userType !== 'super_admin').length;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Users</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>
        A user can only see and do what their role allows. Give every person the role that matches their job.
      </p>

      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      {noRole > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ErrorState
            message={`${noRole} user${noRole > 1 ? 's have' : ' has'} no role, so they cannot use the app at all. Assign a role below.`}
          />
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="New user">
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
              <Button type="submit" loading={busy}>Create</Button>
            </div>
          </Form>
        </Card>
      </div>

      <Card title="Users" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
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
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No users yet" description="Add your first user above." />
        )}
      </Card>

      <p style={{ color: 'var(--mn-subtle)', fontSize: 12, marginTop: 12 }}>
        Changing a role takes effect on the person&apos;s next sign-in. To fine-tune what a role can do, go to
        Setup&nbsp;→&nbsp;Roles.
      </p>
    </div>
  );
}
