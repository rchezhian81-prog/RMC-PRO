'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { usersApi, type Row } from '../../../lib/api';
import { button, card, input, table, td, th } from '../../../lib/ui';

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
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Users</h1>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New User</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Name *</label>
            <input style={{ ...input, width: 180 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Email *</label>
            <input style={{ ...input, width: 220 }} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Password *</label>
            <input style={{ ...input, width: 160 }} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <button style={button}>Create</button>
        </form>
        {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      </section>

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Email</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.name ?? '')}</td>
                <td style={td}>{String(r.email ?? '')}</td>
                <td style={td}>{String(r.status ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
