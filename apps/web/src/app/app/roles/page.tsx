'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { rolesApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

export default function RolesPage() {
  const [roles, setRoles] = useState<Row[]>([]);
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [selRole, setSelRole] = useState<Row | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ roleKey: '', roleName: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [r, c] = await Promise.all([rolesApi.list(), rolesApi.catalog()]);
    setRoles(r);
    setCatalog(c);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function selectRole(role: Row) {
    setSelRole(role);
    setMsg(null);
    setChecked(new Set(await rolesApi.getPerms(String(role.id))));
  }
  function toggle(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function savePerms() {
    if (!selRole) return;
    setError(null);
    try {
      await rolesApi.setPerms(String(selRole.id), [...checked]);
      setMsg('Permissions saved.');
    } catch (e) {
      setError(String(e));
    }
  }
  async function createRole(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await rolesApi.create(form);
      setForm({ roleKey: '', roleName: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Roles &amp; Permissions</h1>
      {error && <ErrorState message={error} />}

      <Card title="New role">
        <form onSubmit={createRole} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <Field label="Role key" required>
              <Input value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })} required />
            </Field>
          </div>
          <div style={{ minWidth: 220 }}>
            <Field label="Role name" required>
              <Input value={form.roleName} onChange={(e) => setForm({ ...form, roleName: e.target.value })} required />
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Card>

      <Card title="Roles" padded={false}>
        {roles.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Key</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.roleName ?? '')}</Td>
                  <Td>{String(r.roleKey ?? '')}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => selectRole(r)}>Permissions</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No roles yet" />
        )}
      </Card>

      {selRole && (
        <Card
          title={`Permissions — ${String(selRole.roleName)}`}
          actions={msg ? <span style={{ color: 'var(--mn-success)', fontSize: 12 }}>{msg}</span> : undefined}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {catalog.map((p) => {
              const id = String(p.id);
              const on = checked.has(id);
              return (
                <label
                  key={id}
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    fontSize: 12.5,
                    border: `1px solid ${on ? 'var(--mn-primary)' : 'var(--mn-border)'}`,
                    background: on ? 'var(--mn-purple-50)' : 'var(--mn-surface)',
                    color: on ? 'var(--mn-primary)' : 'var(--mn-text)',
                    borderRadius: 'var(--mn-radius-pill)',
                    padding: '5px 11px',
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(id)} />
                  {String(p.permissionKey)}
                </label>
              );
            })}
          </div>
          <Button onClick={savePerms}>Save permissions</Button>
        </Card>
      )}
    </div>
  );
}
