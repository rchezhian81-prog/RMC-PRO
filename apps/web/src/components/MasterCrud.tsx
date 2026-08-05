'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, type Row } from '../lib/api';
import type { EntityConfig } from '../lib/entity-config';
import { getAccess } from '../lib/session';
import { Card } from './ui/Card';
import { Table, Th, Td } from './ui/Table';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { ErrorState, EmptyState } from './ui/States';

type Access = { isOwner: boolean; permissions: string[]; has: (k: string) => boolean };
const NO_ACCESS: Access = { isOwner: false, permissions: [], has: () => false };

/**
 * Config-driven master screen: list + create + edit + deactivate, with actions
 * gated by the user's permissions (the company owner sees everything). Number
 * series uses its own `number_series.manage` key; every other master uses the
 * granular `masters.<action>` keys.
 */
export function MasterCrud({ config }: { config: EntityConfig }) {
  const client = crud(config.path);
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<Access>(NO_ACCESS);

  const isNumberSeries = config.path === 'number-series';
  const can = (action: 'create' | 'edit' | 'delete') =>
    isNumberSeries ? access.has('number_series.manage') : access.has(`masters.${action}`);

  async function reload() {
    setRows(await client.list());
  }
  useEffect(() => {
    setAccess(getAccess());
    setForm({});
    setEditingId(null);
    setError(null);
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [config.path]);

  function startEdit(r: Row) {
    const next: Record<string, string> = {};
    for (const f of config.fields) {
      const v = r[f.key];
      next[f.key] = v === null || v === undefined ? '' : String(v);
    }
    setForm(next);
    setEditingId(r.id);
    setError(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({});
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const f of config.fields) {
        const v = form[f.key];
        if (v !== undefined && v !== '') body[f.key] = f.type === 'number' ? Number(v) : v;
      }
      if (editingId) await client.update(editingId, body);
      else await client.create(body);
      cancelEdit();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(r: Row) {
    const labelCol = config.columns[1] ?? config.columns[0] ?? 'id';
    const label = String(r[labelCol] ?? r.id);
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Deactivate "${label}"? It is marked inactive, not permanently deleted.`)
    ) {
      return;
    }
    setError(null);
    try {
      await client.remove(r.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const singular = config.title.replace(/s$/, '');
  const showForm = can('create') || editingId !== null;
  const showActions = can('edit') || can('delete');

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>{config.title}</h1>

      {error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorState message={error} />
        </div>
      )}

      {showForm && (
        <div style={{ marginBottom: 18 }}>
          <Card title={editingId ? `Edit ${singular}` : `New ${singular}`}>
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
              <div style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
                <Button type="submit" loading={busy}>
                  {editingId ? 'Update' : 'Create'}
                </Button>
                {editingId && (
                  <Button type="button" variant="secondary" onClick={cancelEdit}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </div>
      )}

      <Card title={config.title} padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                {config.columns.map((c) => (
                  <Th key={c}>{c}</Th>
                ))}
                {showActions && <Th>actions</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {config.columns.map((c) => (
                    <Td key={c}>{String(r[c] ?? '')}</Td>
                  ))}
                  {showActions && (
                    <Td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {can('edit') && (
                          <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>
                            Edit
                          </Button>
                        )}
                        {can('delete') && (
                          <Button variant="danger" size="sm" onClick={() => deactivate(r)}>
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="No records yet"
            description={
              can('create')
                ? `Add your first ${singular.toLowerCase()} above.`
                : `No ${config.title.toLowerCase()} to show.`
            }
          />
        )}
      </Card>

      {!showForm && !showActions && (
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, marginTop: 10 }}>
          You have view-only access to {config.title.toLowerCase()}.
        </p>
      )}
    </div>
  );
}
