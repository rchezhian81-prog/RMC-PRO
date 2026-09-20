'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Plus, RefreshCw, Search, ShieldAlert, Upload, Users } from 'lucide-react';
import { crud, customersApi, type CustomerExposure, type Row } from '../../../../lib/api';
import { ENTITY_CONFIG } from '../../../../lib/entity-config';
import { money, moneyShort } from '../../../../lib/money';
import { getAccess } from '../../../../lib/session';
import { toCsv, downloadCsv, parseCsv } from '../../../../lib/csv';
import { todayLocal } from '../../../../lib/report-range';
import { MasterForm } from '../../../../components/MasterCrud';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { AlertSurface } from '../../../../components/ui/AlertSurface';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Customers — the master with its credit picture.
 *
 * The plain master list only showed the code, GSTIN and limit. This screen
 * adds each customer's live credit exposure (opening balance + un-invoiced
 * confirmed orders + invoice outstanding − advances) against their limit, as
 * a meter on every row, and lets the owner filter to the ones over or near
 * the limit. Create / edit / deactivate / import / export are the same as
 * every other master; the form is the shared MasterForm.
 */

const config = ENTITY_CONFIG.customers!;
type Access = { isOwner: boolean; permissions: string[]; has: (k: string) => boolean };
const NO_ACCESS: Access = { isOwner: false, permissions: [], has: () => false };
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
/** Where a customer stands against their limit. */
function standing(x: CustomerExposure | undefined): { key: string; tone: Tone; pct: number | null; label: string } {
  if (!x) return { key: 'unknown', tone: 'neutral', pct: null, label: 'Exposure unavailable' };
  if (x.creditLimit <= 0) return { key: 'nolimit', tone: 'neutral', pct: null, label: 'No credit limit set' };
  const pct = (x.exposure / x.creditLimit) * 100;
  if (pct > 100) return { key: 'over', tone: 'danger', pct, label: `Over the limit by ${money(x.exposure - x.creditLimit)}` };
  if (pct >= 80) return { key: 'near', tone: 'warning', pct, label: `${money(x.availableCredit ?? 0)} left` };
  if (x.exposure > 0) return { key: 'owing', tone: 'success', pct, label: `${money(x.availableCredit ?? 0)} left` };
  return { key: 'clear', tone: 'success', pct, label: 'Nothing outstanding' };
}

const CHIPS: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'over', label: 'Over limit', tone: 'danger', hint: 'Exposure above the credit limit; new orders stop on credit hold' },
  { key: 'near', label: 'Near limit', tone: 'warning', hint: 'Using 80% or more of the credit limit' },
  { key: 'owing', label: 'Owing', tone: 'success', hint: 'Has exposure but comfortably within the limit' },
  { key: 'nolimit', label: 'No limit set', tone: 'neutral', hint: 'Credit control is not enforced for these customers' },
  { key: 'inactive', label: 'Inactive', tone: 'neutral', hint: 'Deactivated customers' },
];

export default function CustomersPage() {
  const { confirm } = useConfirm();
  const client = crud(config.path);
  const [rows, setRows] = useState<Row[]>([]);
  const [exposures, setExposures] = useState<Record<string, CustomerExposure>>({});
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>(NO_ACCESS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const can = (action: 'create' | 'edit' | 'delete') => access.has(`masters.${action}`);

  const reload = useCallback(async () => {
    const [list, exp] = await Promise.all([
      client.list(),
      // Exposure is a second read model; if it fails the list still shows.
      customersApi.exposures().catch(() => ({} as Record<string, CustomerExposure>)),
    ]);
    setRows(list);
    setExposures(exp);
  }, []);

  useEffect(() => {
    setAccess(getAccess());
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setBusy(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: Row) {
    setEditingRow(r);
    setEditingId(r.id);
    setShowForm(true);
    setError(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingRow(null);
    setShowForm(false);
    setError(null);
  }

  const isInactive = (r: Row) => String(r.status ?? '') === 'inactive';
  async function deactivate(r: Row) {
    if (!(await confirm({ title: 'Deactivate', message: `Deactivate "${String(r.customerName ?? r.id)}"? It is marked inactive, not permanently deleted.`, confirmLabel: 'Deactivate' }))) return;
    setError(null);
    try { await client.remove(r.id); await reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }
  async function reactivate(r: Row) {
    setError(null);
    try { await client.reactivate(r.id); await reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }

  const fieldKeys = config.fields.map((f) => f.key);
  function exportCsv() {
    const cols = Array.from(new Set([...config.columns, ...fieldKeys]));
    downloadCsv(`${config.path}-${todayLocal()}`, toCsv(rows, cols));
  }
  function downloadTemplate() {
    downloadCsv(`${config.path}-template`, toCsv([], fieldKeys));
  }
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setImportMsg(null);
    setBusy(true);
    try {
      const records = parseCsv(await file.text());
      if (!records.length) { setError('That CSV has no data rows.'); return; }
      let ok = 0;
      const errs: string[] = [];
      for (let i = 0; i < records.length; i++) {
        const rec = records[i] ?? {};
        const body: Record<string, unknown> = {};
        for (const f of config.fields) {
          const v = rec[f.key];
          if (v === undefined || v === '') continue;
          body[f.key] = f.type === 'number' ? Number(v) : f.type === 'boolean' ? String(v).toLowerCase() === 'true' : v;
        }
        try { await client.create(body); ok++; } catch (err) { errs.push(`Row ${i + 2}: ${err instanceof Error ? err.message : 'failed'}`); }
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
  const bucketOf = (r: Row) => (isInactive(r) ? 'inactive' : standing(exposures[String(r.id)]).key);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(bucketOf(r), (m.get(bucketOf(r)) ?? 0) + 1);
    return m;
  }, [rows, exposures]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    let list = rows;
    if (filter) list = list.filter((r) => bucketOf(r) === filter);
    if (q) list = list.filter((r) => ['customerName', 'customerCode', 'city', 'gstin', 'mobile', 'contactPerson'].some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
    // Worst standing first, then by name, so the customers needing a call sit on top.
    const rank: Record<string, number> = { over: 0, near: 1, owing: 2, clear: 3, nolimit: 4, unknown: 5, inactive: 6 };
    return [...list].sort((a, b) => (rank[bucketOf(a)] ?? 9) - (rank[bucketOf(b)] ?? 9) || String(a.customerName ?? '').localeCompare(String(b.customerName ?? '')));
  }, [rows, filter, q, exposures]);
  const active = rows.filter((r) => !isInactive(r));
  const totalExposure = active.reduce((t, r) => t + num(exposures[String(r.id)]?.exposure), 0);
  const over = counts.get('over') ?? 0;
  const near = counts.get('near') ?? 0;
  const chipLabel = (key: string) => CHIPS.find((c) => c.key === key)?.label.toLowerCase() ?? '';
  const showActions = can('edit') || can('delete');

  return (
    <div className="mn-ord">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Customers</h1>
          <p>Who you sell to, with each customer&rsquo;s live credit exposure against their limit. Exposure is opening balance + un-invoiced confirmed orders + invoice outstanding, less advances.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Users size={14} aria-hidden />
            {active.length} active · {moneyShort(totalExposure)} exposure
          </span>
          {can('create') && !showForm && (
            <Button icon={<Plus size={14} />} onClick={() => { setEditingId(null); setEditingRow(null); setShowForm(true); }}>New customer</Button>
          )}
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={busy}>Refresh</Button>
        </div>
      </header>

      <div className="mn-board-strip" role="group" aria-label="Filter by credit standing">
        {CHIPS.map((c) => {
          const n = counts.get(c.key) ?? 0;
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

      {!filter && (over > 0 || near > 0) && (
        <div className="mn-ord-notes">
          {over > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter('over')}>
              <ShieldAlert size={16} aria-hidden />
              <span><strong>{over} {over === 1 ? 'customer is' : 'customers are'} over their credit limit.</strong> New orders for them stop on credit hold until they pay or the limit is raised.</span>
            </button>
          )}
          {near > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('near')}>
              <ShieldAlert size={16} aria-hidden />
              <span><strong>{near} {near === 1 ? 'customer is' : 'customers are'} near the limit</strong> (80% or more used). Worth a collection call before the next order.</span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {importMsg && <AlertSurface tone="success">{importMsg}</AlertSurface>}

      {showForm && (can('create') || editingId) && (
        <MasterForm
          config={config}
          editingId={editingId}
          initial={editingRow}
          onSaved={async () => { cancelEdit(); await reload(); }}
          onCancel={cancelEdit}
          onError={setError}
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> {editingId ? `Edit ${String(editingRow?.customerName ?? 'customer')}` : 'New customer'}</span>}
        />
      )}

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onImportFile} style={{ display: 'none' }} />

      <Card
        title={<span className="mn-board-card-title"><Users size={16} aria-hidden /> Customers <span className="mn-board-card-count">{shown.length}</span></span>}
        padded={false}
      >
        <div className="mn-cu-toolbar">
          <label className="mn-cu-search">
            <Search size={14} aria-hidden />
            <input className="mn-input" placeholder="Search name, code, city, GSTIN, mobile" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search customers" />
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
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-cu-cols" aria-hidden>
              <span>Customer</span>
              <span>Credit used</span>
              <span className="is-num">Exposure</span>
              <span>Terms</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const x = exposures[String(r.id)];
              const st = standing(x);
              const inactive = isInactive(r);
              const place = [r.city, r.state].filter(Boolean).map(String).join(', ');
              const contact = [r.contactPerson, r.mobile].filter(Boolean).map(String).join(' · ');
              return (
                <div key={String(r.id)} className="mn-ord-row mn-cu-row" data-tone={inactive ? 'neutral' : st.tone} role="listitem">
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">{String(r.customerCode ?? '')}{place ? <><span className="mn-ord-dot" aria-hidden>·</span>{place}</> : null}</span>
                    {contact ? <span className="mn-ord-meta">{contact}</span> : null}
                  </div>
                  <div className="mn-cu-credit" data-tone={st.tone}>
                    {x && x.creditLimit > 0 ? (
                      <>
                        <span className="mn-cu-bar" role="img" aria-label={`${Math.round(st.pct ?? 0)}% of the credit limit used`}>
                          <span style={{ width: `${Math.max(0, Math.min(100, st.pct ?? 0))}%` }} />
                        </span>
                        <span className="mn-ord-meta"><strong className="mn-cu-pct">{Math.round(st.pct ?? 0)}%</strong> of {moneyShort(x.creditLimit)}<span className="mn-ord-dot" aria-hidden>·</span><span className="mn-cu-standing">{st.label}</span></span>
                      </>
                    ) : (
                      <span className="mn-ord-meta">{st.label}</span>
                    )}
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{x ? money(x.exposure) : '—'}</span>
                    {x && x.exposure !== 0 ? (
                      <span className="mn-ord-meta" title="Invoices outstanding · un-invoiced confirmed orders · unapplied advances">
                        {[x.invoiceOutstanding > 0 ? `${moneyShort(x.invoiceOutstanding)} invoiced` : '', x.unInvoicedOrderValue > 0 ? `${moneyShort(x.unInvoicedOrderValue)} on orders` : '', x.advanceCredit > 0 ? `−${moneyShort(x.advanceCredit)} advance` : ''].filter(Boolean).join(' · ')}
                      </span>
                    ) : (
                      <span className="mn-ord-meta">nothing owed</span>
                    )}
                  </div>
                  <div className="mn-cu-terms">
                    <span className="mn-ord-when-d">{num(r.creditDays) > 0 ? `${num(r.creditDays)} days credit` : 'Cash terms'}</span>
                    <span className="mn-ord-meta">{r.gstin ? String(r.gstin) : <Badge tone="warning">no GSTIN</Badge>}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={String(r.status ?? 'active')} /></div>
                  <div className="mn-ord-go mn-cu-acts">
                    {showActions && (
                      <span className="mn-ord-act">
                        {can('edit') && <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Button>}
                        {can('delete') && !inactive && <Button variant="ghost" size="sm" onClick={() => deactivate(r)}>Deactivate</Button>}
                        {can('edit') && inactive && <Button variant="secondary" size="sm" onClick={() => reactivate(r)}>Reactivate</Button>}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter || q ? 'No customers match' : 'No customers yet'}
            description={filter || q ? 'Clear the filter or the search to see every customer.' : can('create') ? 'Add your first customer with the button above, or import a CSV.' : 'No customers to show.'}
            action={filter || q ? <Button variant="secondary" size="sm" onClick={() => { setFilter(''); setQuery(''); }}>Show all customers</Button> : undefined}
          />
        )}
        <p className="mn-ord-how mn-ord-how--foot">
          Filtered view: {filter ? chipLabel(filter) : 'all'}{q ? ` · search “${query}”` : ''}. Sorted worst standing first.
        </p>
      </Card>

      {!can('create') && !showActions && (
        <p className="mn-board-form-hint">You have view-only access to customers.</p>
      )}
    </div>
  );
}
