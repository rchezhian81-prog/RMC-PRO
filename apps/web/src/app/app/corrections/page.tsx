'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, PenLine, Plus, RefreshCw, ScrollText, X } from 'lucide-react';
import { formatDateTime } from '../../../lib/format-date';
import { useListWindow } from '../../../lib/list-window';
import { ListCap } from '../../../components/ListCap';
import {
  correctionsApi,
  quotationsApi,
  ordersApi,
  challansApi,
  invoicesApi,
  expensesApi,
  purchaseApi,
  type Row,
} from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input, Select } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * Document corrections — the amendments agreed outside the app, on record.
 *
 * A document strip with live counts doubles as the filter, and each
 * correction is one row: when and who; the document with its kind; what
 * changed, from the old value to the new; and the reason. The record form
 * opens on demand: the document is picked from a list by its number, the
 * way it is referred to everywhere else, never by an id. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const DOC_TYPES: { value: string; label: string; load: () => Promise<Row[]> }[] = [
  { value: 'invoice', label: 'Invoice', load: () => invoicesApi.list(undefined, 200) },
  { value: 'delivery_challan', label: 'Delivery challan', load: () => challansApi.list(undefined, 200) },
  { value: 'vendor_bill', label: 'Supplier bill', load: () => purchaseApi.bills(undefined, 200) },
  { value: 'expense_voucher', label: 'Expense voucher', load: () => expensesApi.vouchers(undefined, 200) },
  { value: 'order', label: 'Order', load: () => ordersApi.list(undefined, 200) },
  { value: 'quotation', label: 'Quotation', load: () => quotationsApi.list(200) },
];
const typeLabel = (v: unknown) => DOC_TYPES.find((t) => t.value === String(v))?.label ?? String(v ?? '').replace(/_/g, ' ');

/** A document's own number, whatever this kind of document calls it. */
function documentNumber(r: Row): string {
  const v =
    r.invoiceNo ?? r.challanNo ?? r.billNo ?? r.supplierBillNo ?? r.voucherNo ?? r.orderNo ?? r.quotationNo;
  return v == null || String(v).trim() === '' ? String(r.id ?? '') : String(v);
}
const FIELDS = ['Vehicle number', 'Site address', 'Quantity', 'Rate', 'Date', 'Customer name', 'GSTIN', 'Payment terms', 'Other'];

export default function CorrectionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [documentType, setDocumentType] = useState('invoice');
  const [docs, setDocs] = useState<Row[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [documentLabel, setDocumentLabel] = useState('');
  const [field, setField] = useState('');
  const [fieldOther, setFieldOther] = useState('');
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');

  const canManage = getAccess().has('document_corrections.manage');

  const reload = useCallback(async () => {
    setRows(await correctionsApi.list(undefined, undefined, win.limit));
  }, [win.limit]);
  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

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

  // Load the documents of the chosen kind so one can be picked by its number.
  useEffect(() => {
    const type = DOC_TYPES.find((t) => t.value === documentType);
    setDocumentId('');
    setDocumentLabel('');
    setDocs([]);
    setDocsError(null);
    if (!type || !canManage || !showForm) return;
    let live = true;
    type
      .load()
      .then((list) => { if (live) setDocs(Array.isArray(list) ? list : []); })
      .catch((e) => { if (live) setDocsError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [documentType, canManage, showForm]);

  async function record(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const what = field === 'Other' ? fieldOther.trim() : field;
    if (!documentId.trim()) { setError('Pick the document that was corrected.'); return; }
    if (!what) { setError('Say what changed on it.'); return; }
    if (!reason.trim()) { setError('Give the reason; it is what the auditor reads.'); return; }
    setBusy(true);
    try {
      await correctionsApi.record({
        documentType, documentId: documentId.trim(), documentLabel: documentLabel || undefined,
        field: what, oldValue: oldValue || undefined, newValue: newValue || undefined, reason: reason.trim(),
      });
      setMsg(`Correction recorded on ${documentLabel || documentId}: ${what}${oldValue || newValue ? ` from ${oldValue || '—'} to ${newValue || '—'}` : ''}.`);
      setDocumentId(''); setDocumentLabel(''); setField(''); setFieldOther(''); setOldValue(''); setNewValue(''); setReason('');
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(String(r.documentType), (c.get(String(r.documentType)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => String(r.documentType) === filter) : rows;
  const kinds = [...DOC_TYPES.map((t) => t.value), ...[...counts.keys()].filter((k) => !DOC_TYPES.some((t) => t.value === k))];

  return (
    <div className="mn-ord mn-cr">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Document corrections</h1>
          <p>An amendment to a document already issued, agreed with a customer or your accountant: what changed, from what to what, and why. Changes made in the app are recorded on their own in the audit trail; this is the record for the ones made outside it.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <PenLine size={14} aria-hidden />
            {loaded ? `${shown.length} ${shown.length === 1 ? 'correction' : 'corrections'}${filter ? ` on ${typeLabel(filter).toLowerCase()}s` : ''}` : 'Loading…'}
          </span>
          {canManage && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>Record a correction</Button>}
          <Link href="/app/audit" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ScrollText size={14} />}>Audit trail</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Document strip — corrections per kind of document; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by document">
        {kinds.map((k) => {
          const c = counts.get(k) ?? 0;
          const on = filter === k;
          return (
            <button key={k} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`} data-tone="info" aria-pressed={on} onClick={() => setFilter(on ? '' : k)}>
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{typeLabel(k)}s</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
      </div>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canManage && (
        <Card
          title={<span className="mn-board-card-title"><PenLine size={16} aria-hidden /> Record a correction</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={record} className="mn-cr-form">
            <Field label="Kind of document">
              <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Document" required help={docsError ? `Could not load the list: ${docsError}` : 'By its number, newest first.'}>
              <Select
                value={documentId}
                required
                onChange={(e) => {
                  const id = e.target.value;
                  setDocumentId(id);
                  const hit = docs.find((d) => String(d.id) === id);
                  setDocumentLabel(hit ? documentNumber(hit) : '');
                }}
              >
                <option value="">{docs.length ? 'Choose one…' : 'No documents of this kind yet'}</option>
                {docs.map((d) => <option key={String(d.id)} value={String(d.id)}>{documentNumber(d)}</option>)}
              </Select>
            </Field>
            <Field label="What changed" required>
              <Select value={field} onChange={(e) => setField(e.target.value)} required>
                <option value="">Choose…</option>
                {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </Field>
            {field === 'Other' ? (
              <Field label="Say what" required>
                <Input value={fieldOther} placeholder="e.g. Pump charge" onChange={(e) => setFieldOther(e.target.value)} required />
              </Field>
            ) : <span aria-hidden />}
            <Field label="From (old value)">
              <Input value={oldValue} onChange={(e) => setOldValue(e.target.value)} />
            </Field>
            <Field label="To (new value)">
              <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            </Field>
            <div className="mn-cr-form-wide">
              <Field label="Reason" required help="Who agreed it and why; this is the line an auditor reads.">
                <Input value={reason} placeholder="e.g. Truck swapped at the gate; the customer's security log has the right number" onChange={(e) => setReason(e.target.value)} required />
              </Field>
            </div>
            <div className="mn-cr-form-submit">
              <Button type="submit" loading={busy} icon={<PenLine size={14} />}>Record it</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">The record cannot be edited or removed afterwards; add another correction if it changes again.</span>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><PenLine size={16} aria-hidden /> Corrections <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Newest first. Each one is also written to the audit trail.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-cr-cols" aria-hidden>
              <span>Recorded</span>
              <span>Document</span>
              <span>What changed</span>
              <span>Reason</span>
            </div>
            {shown.map((r) => (
              <div key={String(r.id)} className="mn-ord-row mn-cr-row" data-tone="info" role="listitem">
                <div className="mn-ord-id">
                  <span className="mn-ord-no">{formatDateTime(r.createdAt)}</span>
                  <span className="mn-ord-meta">{r.correctedByName ? String(r.correctedByName) : 'Someone'}</span>
                </div>
                <div className="mn-ord-who">
                  <span className="mn-ord-cust">{String(r.documentLabel ?? r.documentId)}</span>
                  <span><Badge tone="neutral">{typeLabel(r.documentType)}</Badge></span>
                </div>
                <div className="mn-cr-change">
                  <span className="mn-cr-field">{String(r.field)}</span>
                  <span className="mn-cr-values">
                    <span className="mn-cr-old">{r.oldValue ? String(r.oldValue) : 'not set'}</span>
                    <ArrowRight size={13} aria-hidden />
                    <span className="mn-cr-new">{r.newValue ? String(r.newValue) : 'removed'}</span>
                  </span>
                </div>
                <div className="mn-cr-reason">
                  <span>{r.reason ? String(r.reason) : <span className="mn-ord-meta">No reason recorded</span>}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No corrections on ${typeLabel(filter).toLowerCase()}s` : 'No corrections yet'}
            description={filter ? 'Press the chip again to see every document.' : canManage ? 'When a document is amended outside the app, press Record a correction: the document, what changed, from what to what, and why.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button> : canManage ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>Record a correction</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="corrections" />
      </Card>
    </div>
  );
}
