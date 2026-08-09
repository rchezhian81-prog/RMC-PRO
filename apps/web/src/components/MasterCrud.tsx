'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, Upload, FileText } from 'lucide-react';
import { validateMasterFields } from '@rmc/shared';
import { crud, ApiError, type Row } from '../lib/api';
import type { EntityConfig } from '../lib/entity-config';
import { getAccess } from '../lib/session';
import { toCsv, downloadCsv, parseCsv } from '../lib/csv';
import { Card } from './ui/Card';
import { Table, Th, Td } from './ui/Table';
import { Button } from './ui/Button';
import { Form } from './ui/Form';
import { Field, Input } from './ui/Field';
import { ErrorState, EmptyState } from './ui/States';
import { useConfirm } from './ui/ConfirmDialog';

type Access = { isOwner: boolean; permissions: string[]; has: (k: string) => boolean };
const NO_ACCESS: Access = { isOwner: false, permissions: [], has: () => false };

/**
 * Config-driven master screen: list + create + edit + deactivate, with actions
 * gated by the user's permissions (the company owner sees everything). Number
 * series uses its own `number_series.manage` key; every other master uses the
 * granular `masters.<action>` keys.
 */
export function MasterCrud({ config }: { config: EntityConfig }) {
  const { confirm } = useConfirm();
  const client = crud(config.path);
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>(NO_ACCESS);
  const fileRef = useRef<HTMLInputElement>(null);

  const isNumberSeries = config.path === 'number-series';
  const can = (action: 'create' | 'edit' | 'delete') =>
    isNumberSeries ? access.has('number_series.manage') : access.has(`masters.${action}`);
  const fieldKeys = config.fields.map((f) => f.key);

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
    setFieldErrors({});
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({});
    setError(null);
    setFieldErrors({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const body: Record<string, unknown> = {};
    for (const f of config.fields) {
      const v = form[f.key];
      if (v !== undefined && v !== '') body[f.key] = f.type === 'number' ? Number(v) : v;
    }
    // Client-side validation using the SAME rules the server enforces, so the
    // user gets immediate field-level feedback before a round trip.
    const clientErrors = validateMasterFields(body);
    if (Object.keys(clientErrors).length) {
      setFieldErrors(clientErrors);
      return;
    }
    setBusy(true);
    try {
      if (editingId) await client.update(editingId, body);
      else await client.create(body);
      cancelEdit();
      await reload();
    } catch (err) {
      // Surface the server's per-field errors (source of truth) when present.
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        setFieldErrors(err.fields);
        setError('Please correct the highlighted fields.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(r: Row) {
    const labelCol = config.columns[1] ?? config.columns[0] ?? 'id';
    const label = String(r[labelCol] ?? r.id);
    if (
      !(await confirm({
        title: 'Deactivate',
        message: `Deactivate "${label}"? It is marked inactive, not permanently deleted.`,
        confirmLabel: 'Deactivate',
      }))
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

  function exportCsv() {
    const cols = Array.from(new Set([...config.columns, ...fieldKeys]));
    downloadCsv(`${config.path}-${new Date().toISOString().slice(0, 10)}`, toCsv(rows, cols));
  }

  function downloadTemplate() {
    downloadCsv(`${config.path}-template`, toCsv([], fieldKeys));
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setImportMsg(null);
    setBusy(true);
    try {
      const records = parseCsv(await file.text());
      if (!records.length) {
        setError('That CSV has no data rows.');
        return;
      }
      let ok = 0;
      const errs: string[] = [];
      for (let i = 0; i < records.length; i++) {
        const rec = records[i] ?? {};
        const body: Record<string, unknown> = {};
        for (const f of config.fields) {
          const v = rec[f.key];
          if (v !== undefined && v !== '') body[f.key] = f.type === 'number' ? Number(v) : v;
        }
        try {
          await client.create(body);
          ok++;
        } catch (err) {
          errs.push(`Row ${i + 2}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      await reload();
      setImportMsg(`Imported ${ok} of ${records.length} row(s)${errs.length ? `, ${errs.length} failed` : ''}.`);
      if (errs.length) setError(errs.slice(0, 8).join(' · ') + (errs.length > 8 ? ' · …' : ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
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
            <Form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              {config.fields.map((f) => (
                <div key={f.key} style={{ minWidth: 150 }}>
                  <Field label={f.label} required={f.required}>
                    <Input
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={form[f.key] ?? ''}
                      onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                      required={f.required}
                      aria-invalid={fieldErrors[f.key] ? true : undefined}
                      style={fieldErrors[f.key] ? { borderColor: 'var(--mn-danger)' } : undefined}
                    />
                  </Field>
                  {fieldErrors[f.key] && (
                    <p style={{ color: 'var(--mn-danger)', fontSize: 12, margin: '4px 0 0' }}>{fieldErrors[f.key]}</p>
                  )}
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
            </Form>
          </Card>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onImportFile}
        style={{ display: 'none' }}
      />

      <Card
        title={config.title}
        padded={false}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {importMsg && <span style={{ color: 'var(--mn-success)', fontSize: 12 }}>{importMsg}</span>}
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={15} />}
              onClick={exportCsv}
              disabled={!rows.length}
            >
              Export CSV
            </Button>
            {can('create') && (
              <>
                <Button variant="ghost" size="sm" icon={<FileText size={15} />} onClick={downloadTemplate}>
                  Template
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Upload size={15} />}
                  onClick={() => fileRef.current?.click()}
                  loading={busy}
                >
                  Import CSV
                </Button>
              </>
            )}
          </div>
        }
      >
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
