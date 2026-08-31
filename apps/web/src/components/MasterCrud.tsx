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
import { ErrorState, EmptyState, TableSkeleton } from './ui/States';
import { useConfirm } from './ui/ConfirmDialog';

type Access = { isOwner: boolean; permissions: string[]; has: (k: string) => boolean };
const NO_ACCESS: Access = { isOwner: false, permissions: [], has: () => false };

/** A fresh create-form: booleans seeded to their default so an untouched
 * checkbox matches what the server would store (e.g. a series starts Active). */
const blankForm = (config: EntityConfig): Record<string, string> => {
  const f: Record<string, string> = {};
  for (const fld of config.fields) if (fld.type === 'boolean') f[fld.key] = String(fld.default ?? false);
  return f;
};

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
  // Dropdown options for relational (`ref`) fields, keyed by field key. Fetched
  // from the referenced master so the operator picks a real record, not an id.
  const [refOptions, setRefOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [busy, setBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>(NO_ACCESS);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isNumberSeries = config.path === 'number-series';
  const can = (action: 'create' | 'edit' | 'delete') =>
    isNumberSeries ? access.has('number_series.manage') : access.has(`masters.${action}`);
  const fieldKeys = config.fields.map((f) => f.key);
  // Columns backed by a boolean field render as Yes/No instead of raw true/false.
  const boolCols = new Set(config.fields.filter((f) => f.type === 'boolean').map((f) => f.key));
  const cell = (c: string, r: Row) => (boolCols.has(c) ? (r[c] ? 'Yes' : 'No') : String(r[c] ?? ''));

  async function reload() {
    setRows(await client.list());
  }
  useEffect(() => {
    setAccess(getAccess());
    setForm(blankForm(config));
    setEditingId(null);
    setError(null);
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [config.path]);

  // Populate dropdown options for relational (`ref`) fields from their masters.
  // One fetch per distinct referenced path; a failure (e.g. no read permission)
  // leaves that field's options empty so the select still renders, just blank.
  useEffect(() => {
    const refFields = config.fields.filter((f) => f.ref);
    if (!refFields.length) {
      setRefOptions({});
      return;
    }
    let cancelled = false;
    (async () => {
      const cache: Record<string, Row[]> = {};
      const collected: Record<string, { value: string; label: string }[]> = {};
      for (const f of refFields) {
        const ref = f.ref!;
        try {
          // Pick-lists offer only ACTIVE masters — a deactivated one shouldn't be
          // selectable for a new reference (the master's own screen still lists all).
          const refRows = cache[ref.path] ?? (cache[ref.path] = await crud(ref.path).list({ active: true }));
          collected[f.key] = refRows.map((row) => ({
            value: String(row[ref.value] ?? ''),
            label: String(row[ref.label] ?? row[ref.value] ?? ''),
          }));
        } catch {
          collected[f.key] = [];
        }
      }
      if (!cancelled) setRefOptions(collected);
    })();
    return () => {
      cancelled = true;
    };
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
    setForm(blankForm(config));
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
      // A boolean always carries a definite state (seeded on new, read on edit),
      // so it is always sent — never skipped by the empty-value rule below.
      if (f.type === 'boolean') { body[f.key] = v === 'true'; continue; }
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

  async function reactivate(r: Row) {
    setError(null);
    try {
      await client.reactivate(r.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  // A soft-deleted row shows a status of 'inactive' (status-based masters) or
  // isActive === false (number series); it gets Reactivate instead of Deactivate.
  const isInactive = (r: Row) => String(r.status ?? '') === 'inactive' || r.isActive === false;

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
          if (v === undefined || v === '') continue;
          body[f.key] =
            f.type === 'number' ? Number(v) : f.type === 'boolean' ? String(v).toLowerCase() === 'true' : v;
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

      <div className={showForm ? 'mn-crud' : undefined}>
        {showForm && (
          <div className="mn-crud-aside">
            <Card title={editingId ? `Edit ${singular}` : `New ${singular}`}>
            <Form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              {config.fields.map((f) => {
                // A static option list, or one fetched from a referenced master.
                const opts = f.options ?? (f.ref ? refOptions[f.key] ?? [] : undefined);
                return (
                <div key={f.key} style={{ minWidth: 150 }}>
                  <Field label={f.label} required={f.required}>
                    {f.type === 'boolean' ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={form[f.key] === 'true'}
                          onChange={(e) => setForm((p) => ({ ...p, [f.key]: String(e.target.checked) }))}
                          style={{ width: 16, height: 16, accentColor: 'var(--mn-primary)' }}
                        />
                        <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>{form[f.key] === 'true' ? 'Yes' : 'No'}</span>
                      </label>
                    ) : opts ? (
                      <select
                        value={form[f.key] ?? ''}
                        onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                        required={f.required}
                        aria-invalid={fieldErrors[f.key] ? true : undefined}
                        style={{
                          width: '100%',
                          padding: '9px 11px',
                          borderRadius: 8,
                          border: `1px solid ${fieldErrors[f.key] ? 'var(--mn-danger)' : 'var(--mn-border, #d9d9e3)'}`,
                          background: 'var(--mn-surface, #fff)',
                          color: 'inherit',
                        }}
                      >
                        <option value="">—</option>
                        {opts.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                        value={form[f.key] ?? ''}
                        onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                        required={f.required}
                        aria-invalid={fieldErrors[f.key] ? true : undefined}
                        style={fieldErrors[f.key] ? { borderColor: 'var(--mn-danger)' } : undefined}
                      />
                    )}
                  </Field>
                  {fieldErrors[f.key] && (
                    <p style={{ color: 'var(--mn-danger)', fontSize: 12, margin: '4px 0 0' }}>{fieldErrors[f.key]}</p>
                  )}
                </div>
                );
              })}
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

      <div className="mn-crud-main">
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
        {!loaded ? (
          <TableSkeleton cols={config.columns.length + (showActions ? 1 : 0)} />
        ) : rows.length ? (
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
                    <Td key={c}>{cell(c, r)}</Td>
                  ))}
                  {showActions && (
                    <Td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {can('edit') && (
                          <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>
                            Edit
                          </Button>
                        )}
                        {can('delete') && !isInactive(r) && (
                          <Button variant="danger" size="sm" onClick={() => deactivate(r)}>
                            Deactivate
                          </Button>
                        )}
                        {can('edit') && isInactive(r) && (
                          <Button variant="secondary" size="sm" onClick={() => reactivate(r)}>
                            Reactivate
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
      </div>
      </div>

      {!showForm && !showActions && (
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, marginTop: 10 }}>
          You have view-only access to {config.title.toLowerCase()}.
        </p>
      )}
    </div>
  );
}
