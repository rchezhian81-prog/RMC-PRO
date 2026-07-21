'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { usersApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

export default function UsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setRows(await usersApi.list());
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await usersApi.create(form);
      setForm({ name: '', email: '', password: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Users</h1>

      <div style={{ marginBottom: 18 }}>
        <Card title="New user">
          <form onSubmit={create} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ minWidth: 180 }}>
              <Field label="Name" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
            </div>
            <div style={{ minWidth: 220 }}>
              <Field label="Email" required>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </Field>
            </div>
            <div style={{ minWidth: 160 }}>
              <Field label="Password" required>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </form>
          {error && <div style={{ marginTop: 4 }}><ErrorState message={error} /></div>}
        </Card>
      </div>

      <Card title="Users" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.name ?? '')}</Td>
                  <Td>{String(r.email ?? '')}</Td>
                  <Td><StatusBadge status={String(r.status ?? '')} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No users yet" description="Add your first user above." />
        )}
      </Card>
    </div>
  );
}
