'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, type Row } from '../lib/api';
import type { EntityConfig } from '../lib/entity-config';
import { Card } from './ui/Card';
import { Table, Th, Td } from './ui/Table';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { ErrorState, EmptyState } from './ui/States';

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
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>{config.title}</h1>

      <div style={{ marginBottom: 18 }}>
        <Card title={`New ${config.title.replace(/s$/, '')}`}>
          <form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            {config.fields.map((f) => (
              <div key={f.key} style={{ minWidth: 150 }}>
                <Field label={f.label} required={f.required}>
                  <Input
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    required={f.required}
                  />
                </Field>
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </form>
          {error && <div style={{ marginTop: 4 }}><ErrorState message={error} /></div>}
        </Card>
      </div>

      <Card title={config.title} padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                {config.columns.map((c) => (
                  <Th key={c}>{c}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {config.columns.map((c) => (
                    <Td key={c}>{String(r[c] ?? '')}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No records yet" description={`Add your first ${config.title.replace(/s$/, '').toLowerCase()} above.`} />
        )}
      </Card>
    </div>
  );
}
