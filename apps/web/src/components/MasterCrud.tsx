'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, type Row } from '../lib/api';
import type { EntityConfig } from '../lib/entity-config';
import { button, card, input, table, td, th } from '../lib/ui';

/** Config-driven list + create screen reused by every tenant master. */
export function MasterCrud({ config }: { config: EntityConfig }) {
  const client = crud(config.path);
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setRows(await client.list());
  }
  useEffect(() => {
    setForm({});
    reload().catch((e) => setError(String(e)));
  }, [config.path]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const f of config.fields) {
        const v = form[f.key];
        if (v !== undefined && v !== '') body[f.key] = f.type === 'number' ? Number(v) : v;
      }
      await client.create(body);
      setForm({});
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{config.title}</h1>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New {config.title.replace(/s$/, '')}</h3>
        <form onSubmit={submit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          {config.fields.map((f) => (
            <div key={f.key}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                {f.label}
                {f.required ? ' *' : ''}
              </label>
              <input
                style={{ ...input, width: 150 }}
                type={f.type === 'number' ? 'number' : 'text'}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                required={f.required}
              />
            </div>
          ))}
          <button style={button}>Create</button>
        </form>
        {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      </section>

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              {config.columns.map((c) => (
                <th key={c} style={th}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {config.columns.map((c) => (
                  <td key={c} style={td}>
                    {String(r[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...td, color: 'var(--muted)' }} colSpan={config.columns.length}>
                  No records yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
