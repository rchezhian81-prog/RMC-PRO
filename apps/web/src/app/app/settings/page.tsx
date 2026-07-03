'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { settings, type Row } from '../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../lib/ui';

export default function SettingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const list = await settings.list();
    setRows(list);
    setEdit(Object.fromEntries(list.map((r) => [String(r.settingKey), String(r.settingValue ?? '')])));
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function save(key: string) {
    setError(null);
    try {
      await settings.set(key, edit[key] ?? '');
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await settings.set(newKey, newVal);
      setNewKey('');
      setNewVal('');
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Tenant Settings</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Key</th>
              <th style={th}>Value</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = String(r.settingKey);
              return (
                <tr key={r.id}>
                  <td style={td}>{key}</td>
                  <td style={td}>
                    <input
                      style={{ ...input, width: 260 }}
                      value={edit[key] ?? ''}
                      onChange={(e) => setEdit((p) => ({ ...p, [key]: e.target.value }))}
                    />
                  </td>
                  <td style={td}>
                    <button style={ghostButton} onClick={() => save(key)}>
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Add setting</h3>
        <form onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Key</label>
            <input style={{ ...input, width: 200 }} value={newKey} onChange={(e) => setNewKey(e.target.value)} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Value</label>
            <input style={{ ...input, width: 200 }} value={newVal} onChange={(e) => setNewVal(e.target.value)} />
          </div>
          <button style={button}>Add</button>
        </form>
      </section>
    </div>
  );
}
