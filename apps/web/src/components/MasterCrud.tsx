'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Download, FileText, Plus, RefreshCw, Search, ShieldAlert, Upload, X } from 'lucide-react';
import { validateMasterFields } from '@rmc/shared';
import { crud, ApiError, type Row } from '../lib/api';
import type { EntityConfig, FieldDef } from '../lib/entity-config';
import { getAccess } from '../lib/session';
import { toCsv, downloadCsv, parseCsv } from '../lib/csv';
import { formatDate } from '../lib/format-date';
import { todayLocal } from '../lib/report-range';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Form } from './ui/Form';
import { Field, Input, Select } from './ui/Field';
import { StatusBadge } from './ui/Badge';
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

const singularOf = (config: EntityConfig) => config.singular ?? config.title.replace(/s$/, '').toLowerCase();
const humanize = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * The create / edit form for one master, on its own so a bespoke master screen
 * (the customers list) can reuse it beside its own list. It owns the field
 * state, the client-side validation (the same rules the server enforces) and
 * the ref-field pick-lists; the caller decides where it sits and what happens
 * after a save. Fields sit in a grid that fills the width and stacks on a
 * phone; each carries its one-line help from the config.
 */
export function MasterForm({
  config,
  editingId,
  initial,
  onSaved,
  onCancel,
  title,
  onError,
}: {
  config: EntityConfig;
  /** The row being edited, or null for a new record. */
  editingId: string | null;
  /** The row's current values when editing. */
  initial?: Row | null;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
  title?: ReactNode;
  /** Optional hook so the parent can show a general error where it prefers. */
  onError?: (message: string | null) => void;
}) {
  const client = crud(config.path);
  const [form, setForm] = useState<Record<string, string>>(() => blankForm(config));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  // Dropdown options for relational (`ref`) fields, keyed by field key. Fetched
  // from the referenced master so the operator picks a real record, not an id.
  const [refOptions, setRefOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [busy, setBusy] = useState(false);
  const setError = (m: string | null) => { setLocalError(m); onError?.(m); };

  // Fill from the row being edited, or start blank for a new record.
  useEffect(() => {
    if (editingId && initial) {
      const next: Record<string, string> = {};
      for (const f of config.fields) {
        const v = initial[f.key];
        // A date column arrives as an ISO timestamp; the input wants YYYY-MM-DD.
        next[f.key] = v === null || v === undefined ? '' : f.type === 'date' ? String(v).slice(0, 10) : String(v);
      }
      setForm(next);
    } else {
      setForm(blankForm(config));
    }
    setFieldErrors({});
    setLocalError(null);
  }, [editingId, initial, config]);

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
  }, [config]);

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
      setForm(blankForm(config));
      await onSaved();
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

  const singular = singularOf(config);
  return (
    <Card
      title={title ?? <span className="mn-board-card-title"><Plus size={16} aria-hidden /> {editingId ? `Edit ${singular}` : `New ${singular}`}</span>}
      actions={<Button type="button" variant="ghost" size="sm" icon={<X size={14} />} onClick={onCancel}>{editingId ? 'Cancel' : 'Close'}</Button>}
    >
      {localError && !onError && (
        <div style={{ marginBottom: 12 }}>
          <ErrorState message={localError} />
        </div>
      )}
      <Form onSubmit={submit} className="mn-ma-form">
        {config.fields.map((f) => {
          // A static option list, or one fetched from a referenced master.
          const opts = f.options ?? (f.ref ? refOptions[f.key] ?? [] : undefined);
          return (
            <Field key={f.key} label={f.label} required={f.required} help={f.help} error={fieldErrors[f.key]}>
              {f.type === 'boolean' ? (
                <label className="mn-ma-check">
                  <input
                    type="checkbox"
                    checked={form[f.key] === 'true'}
                    onChange={(e) => setForm((p) => ({ ...p, [f.key]: String(e.target.checked) }))}
                  />
                  <span>{form[f.key] === 'true' ? 'Yes' : 'No'}</span>
                </label>
              ) : opts ? (
                <Select
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  required={f.required}
                  aria-invalid={fieldErrors[f.key] ? true : undefined}
                >
                  <option value="">{f.required ? 'Choose…' : '—'}</option>
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  required={f.required}
                  aria-invalid={fieldErrors[f.key] ? true : undefined}
                />
              )}
            </Field>
          );
        })}
        <div className="mn-ma-form-acts">
          <Button type="submit" loading={busy} icon={<CheckCircle2 size={14} />}>
            {editingId ? 'Save changes' : `Add ${singular}`}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {editingId ? 'Cancel' : 'Close'}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

// ---- Row facts ---------------------------------------------------------------

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const SOON_DAYS = 30;

/** Days from today to a date column, or null when it is blank. */
function daysUntil(v: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** An expiry column (…Expiry) that has lapsed or lapses within 30 days. */
function expiryTone(f: FieldDef | undefined, v: unknown): { tone: Tone; note: string } | null {
  if (!f || f.type !== 'date' || !/expiry$/i.test(f.key)) return null;
  const days = daysUntil(v);
  if (days === null) return null;
  if (days < 0) return { tone: 'danger', note: `expired ${-days === 1 ? 'yesterday' : `${-days} days ago`}` };
  if (days === 0) return { tone: 'danger', note: 'expires today' };
  if (days <= SOON_DAYS) return { tone: 'warning', note: `in ${days} ${days === 1 ? 'day' : 'days'}` };
  return null;
}

/** The value of one column, worded for the row: labels for options, Yes/No,
 * formatted numbers and dates. */
function cellText(f: FieldDef | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (f?.type === 'boolean') return v ? 'Yes' : 'No';
  if (f?.options) return f.options.find((o) => o.value === String(v))?.label ?? String(v);
  if (f?.type === 'date') return formatDate(v);
  if (f?.type === 'number') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/**
 * Config-driven master screen: list + create + edit + deactivate, with actions
 * gated by the user's permissions (the company owner sees everything). Number
 * series uses its own `number_series.manage` key; every other master uses the
 * granular `masters.<action>` keys.
 *
 * The list is one row per record: the name with its code, the remaining
 * columns as labelled facts (expiry dates flagged when lapsed or due within
 * 30 days), the status, and Edit / Deactivate / Reactivate. A status strip
 * (active / inactive / needs attention) doubles as the filter, with a search
 * across every column; the form opens on demand above the list. Same layout
 * in both skins; every colour reads the semantic tokens.
 */
export function MasterCrud({ config }: { config: EntityConfig }) {
  const { confirm } = useConfirm();
  const client = crud(config.path);
  const [rows, setRows] = useState<Row[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>(NO_ACCESS);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isNumberSeries = config.path === 'number-series';
  const can = (action: 'create' | 'edit' | 'delete') =>
    isNumberSeries ? access.has('number_series.manage') : access.has(`masters.${action}`);
  const fieldKeys = config.fields.map((f) => f.key);
  const fieldOf = (key: string) => config.fields.find((f) => f.key === key);
  const labelOf = (key: string) => fieldOf(key)?.label ?? humanize(key);
  const singular = singularOf(config);

  async function reload() {
    setRows(await client.list());
  }
  useEffect(() => {
    setAccess(getAccess());
    setEditingId(null);
    setEditingRow(null);
    setShowForm(false);
    setFilter('');
    setQuery('');
    setError(null);
    setImportMsg(null);
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [config.path]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  function startNew() {
    setEditingId(null);
    setEditingRow(null);
    setShowForm(true);
    setError(null);
    setImportMsg(null);
  }
  function startEdit(r: Row) {
    setEditingRow(r);
    setEditingId(r.id);
    setShowForm(true);
    setError(null);
    setImportMsg(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingRow(null);
    setShowForm(false);
    setError(null);
  }

  // A soft-deleted row shows a status of 'inactive' (status-based masters) or
  // isActive === false (number series); it gets Reactivate instead of Deactivate.
  const isInactive = (r: Row) => String(r.status ?? '') === 'inactive' || r.isActive === false;
  // The name column is the second configured column (the first is the code);
  // number series has no name, so its document type stands in.
  const nameKey = config.nameKey ?? (config.columns[1] && !/status|isActive/.test(config.columns[1]) ? config.columns[1] : config.columns[0] ?? 'id');
  // The code sits under the name; a series' document type is its name already.
  const codeKey = nameKey === config.columns[0] || isNumberSeries ? null : config.columns[0] ?? null;
  const nameOf = (r: Row) => (isNumberSeries ? cellText(fieldOf('documentType'), r.documentType) || humanize(String(r.documentType ?? '')) : String(r[nameKey] ?? r.id));

  async function deactivate(r: Row) {
    if (
      !(await confirm({
        title: `Deactivate ${singular}`,
        message: `"${nameOf(r)}" is hidden from every pick-list and cannot be used on new documents. Nothing already booked against it changes, and it can be reactivated here later.`,
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

  function exportCsv() {
    const cols = Array.from(new Set([...config.columns, ...fieldKeys]));
    downloadCsv(`${config.path}-${todayLocal()}`, toCsv(rows, cols));
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

  // ---- derived ----
  // The columns shown as facts: everything configured except the name, the
  // code and the status, which have their own places on the row.
  const factKeys = config.columns.filter((c) => c !== nameKey && c !== codeKey && !(isNumberSeries && c === 'documentType') && !/^(status|isActive)$/.test(c));
  const hasExpiry = config.fields.some((f) => f.type === 'date' && /expiry$/i.test(f.key));
  /** The worst expiry on a row: lapsed beats due soon. */
  const attention = (r: Row): Tone | null => {
    let worst: Tone | null = null;
    for (const f of config.fields) {
      const t = expiryTone(f, r[f.key]);
      if (t?.tone === 'danger') return 'danger';
      if (t?.tone === 'warning') worst = 'warning';
    }
    return worst;
  };
  const bucketOf = (r: Row) => (isInactive(r) ? 'inactive' : attention(r) ? 'attention' : 'active');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(bucketOf(r), (m.get(bucketOf(r)) ?? 0) + 1);
    return m;
  }, [rows, config]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    let list = rows;
    if (filter === 'active') list = list.filter((r) => !isInactive(r));
    else if (filter) list = list.filter((r) => bucketOf(r) === filter);
    if (q) list = list.filter((r) => Array.from(new Set([...config.columns, ...fieldKeys])).some((k) => cellText(fieldOf(k), r[k]).toLowerCase().includes(q) || String(r[k] ?? '').toLowerCase().includes(q)));
    // Lapsed papers first, then due soon, then the rest by name; inactive last.
    const rank: Record<string, number> = { danger: 0, warning: 1 };
    return [...list].sort((a, b) => {
      const ia = isInactive(a) ? 1 : 0;
      const ib = isInactive(b) ? 1 : 0;
      if (ia !== ib) return ia - ib;
      const ra = rank[attention(a) ?? ''] ?? 2;
      const rb = rank[attention(b) ?? ''] ?? 2;
      if (ra !== rb) return ra - rb;
      return nameOf(a).localeCompare(nameOf(b));
    });
  }, [rows, filter, q, config]);
  const activeCount = rows.filter((r) => !isInactive(r)).length;
  const needing = counts.get('attention') ?? 0;
  const showActions = can('edit') || can('delete');
  const CHIPS: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
    { key: 'active', label: 'Active', tone: 'success', hint: `In use: offered on every pick-list` },
    ...(hasExpiry ? [{ key: 'attention', label: 'Papers due', tone: 'warning' as Tone, hint: `An expiry has lapsed or falls within ${SOON_DAYS} days` }] : []),
    { key: 'inactive', label: 'Inactive', tone: 'neutral', hint: 'Deactivated: hidden from pick-lists, kept for history' },
  ];

  return (
    <div className="mn-ord mn-ma">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>{config.title}</h1>
          {config.description ? <p>{config.description}</p> : null}
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            {loaded ? `${activeCount} active` : 'Loading…'}{needing ? ` · ${needing} papers due` : ''}
          </span>
          {can('create') && !showForm && (
            <Button icon={<Plus size={14} />} onClick={startNew}>New {singular}</Button>
          )}
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>Refresh</Button>
        </div>
      </header>

      <div className="mn-board-strip" role="group" aria-label="Filter by status">
        {CHIPS.map((c) => {
          const n = c.key === 'active' ? activeCount : counts.get(c.key) ?? 0;
          const on = filter === c.key;
          return (
            <button key={c.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${n === 0 ? ' is-empty' : ''}`} data-tone={c.tone} aria-pressed={on} title={c.hint} onClick={() => setFilter(on ? '' : c.key)}>
              <span className="mn-board-chip-n">{n}</span>
              <span className="mn-board-chip-l">{c.label}</span>
            </button>
          );
        })}
        {filter && (
          <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>
        )}
      </div>

      {needing > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('attention')}>
            <ShieldAlert size={16} aria-hidden />
            <span><strong>{needing} {needing === 1 ? `${singular} has` : `${config.title.toLowerCase()} have`} papers lapsed or due within {SOON_DAYS} days.</strong> Renew them and update the dates here so the flag clears.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {importMsg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{importMsg}</span></div>}

      {showForm && (can('create') || editingId) && (
        <MasterForm
          config={config}
          editingId={editingId}
          initial={editingRow}
          onSaved={async () => { cancelEdit(); await reload(); }}
          onCancel={cancelEdit}
          onError={setError}
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> {editingId ? `Edit ${editingRow ? nameOf(editingRow) : singular}` : `New ${singular}`}</span>}
        />
      )}

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onImportFile} style={{ display: 'none' }} />

      <Card
        title={<span className="mn-board-card-title">{config.title} <span className="mn-board-card-count">{shown.length}</span></span>}
        padded={false}
      >
        <div className="mn-cu-toolbar">
          <label className="mn-cu-search">
            <Search size={14} aria-hidden />
            <input className="mn-input" placeholder={`Search ${config.title.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${config.title.toLowerCase()}`} />
          </label>
          <div className="mn-cu-tools">
            <Button variant="ghost" size="sm" icon={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
            {can('create') && (
              <>
                <Button variant="ghost" size="sm" icon={<FileText size={15} />} onClick={downloadTemplate}>Template</Button>
                <Button variant="secondary" size="sm" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()} loading={busy}>Import CSV</Button>
              </>
            )}
          </div>
        </div>
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={4} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ma-cols" aria-hidden>
              <span>{isNumberSeries ? 'Document' : singular.replace(/^./, (c) => c.toUpperCase())}</span>
              <span>Details</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const inactive = isInactive(r);
              const tone: Tone = inactive ? 'neutral' : attention(r) ?? 'success';
              const facts = factKeys
                .map((k) => ({ key: k, label: labelOf(k), text: cellText(fieldOf(k), r[k]), flag: expiryTone(fieldOf(k), r[k]) }))
                .filter((f) => f.text);
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ma-row${inactive ? ' is-void' : ''}`} data-tone={tone} role="listitem">
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{nameOf(r)}</span>
                    {codeKey && r[codeKey] ? <span className="mn-ord-meta">{String(r[codeKey])}</span> : null}
                    {isNumberSeries ? (
                      <span className="mn-ord-meta">next {String(r.prefix ?? '')}{String(Number(r.currentNumber ?? 0) + 1).padStart(Number(r.paddingLength ?? 0), '0')}{String(r.suffix ?? '')}</span>
                    ) : null}
                  </div>
                  <div className="mn-ma-facts">
                    {facts.length ? facts.map((f) => (
                      <span key={f.key} className="mn-ma-fact" data-tone={f.flag?.tone}>
                        <b>{f.label}</b> {f.text}{f.flag ? ` · ${f.flag.note}` : ''}
                      </span>
                    )) : <span className="mn-ord-meta">Only the name and code are filled in.</span>}
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={inactive ? 'inactive' : 'active'} /></div>
                  <div className="mn-ord-act mn-ma-acts">
                    {showActions && (
                      <>
                        {can('edit') && <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Button>}
                        {can('delete') && !inactive && <Button variant="ghost" size="sm" onClick={() => deactivate(r)}>Deactivate</Button>}
                        {can('edit') && inactive && <Button variant="secondary" size="sm" onClick={() => reactivate(r)}>Reactivate</Button>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter || q ? `No ${config.title.toLowerCase()} match` : `No ${config.title.toLowerCase()} yet`}
            description={filter || q ? 'Clear the filter or the search to see every record.' : can('create') ? `Add the first ${singular} with the button above, or import a CSV (download the template for the column names).` : `No ${config.title.toLowerCase()} to show.`}
            action={filter || q ? <Button variant="secondary" size="sm" onClick={() => { setFilter(''); setQuery(''); }}>Show all</Button> : can('create') ? <Button size="sm" icon={<Plus size={14} />} onClick={startNew}>New {singular}</Button> : undefined}
          />
        )}
      </Card>

      {!can('create') && !showActions && (
        <p className="mn-board-form-hint">You have view-only access to {config.title.toLowerCase()}.</p>
      )}
    </div>
  );
}
