'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { rolesApi, type Row } from '../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../lib/ui';

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
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Roles &amp; Permissions</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Role</h3>
        <form onSubmit={createRole} style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Role key</label>
            <input style={{ ...input, width: 180 }} value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Role name</label>
            <input style={{ ...input, width: 220 }} value={form.roleName} onChange={(e) => setForm({ ...form, roleName: e.target.value })} required />
          </div>
          <button style={button}>Create</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Role</th>
              <th style={th}>Key</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.roleName ?? '')}</td>
                <td style={td}>{String(r.roleKey ?? '')}</td>
                <td style={td}>
                  <button style={ghostButton} onClick={() => selectRole(r)}>
                    Permissions
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selRole && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>
            Permissions — {String(selRole.roleName)}{' '}
            {msg && <span style={{ color: '#6ee7a8', fontSize: 12 }}>({msg})</span>}
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 14px' }}>
            {catalog.map((p) => {
              const id = String(p.id);
              return (
                <label key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, border: '1px solid #26314b', borderRadius: 8, padding: '4px 8px' }}>
                  <input type="checkbox" checked={checked.has(id)} onChange={() => toggle(id)} />
                  {String(p.permissionKey)}
                </label>
              );
            })}
          </div>
          <button style={button} onClick={savePerms}>
            Save permissions
          </button>
        </section>
      )}
    </div>
  );
}
