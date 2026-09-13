'use client';

import { useEffect, useState } from 'react';
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
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * The documents that can carry a correction, each with the list to choose from.
 *
 * This screen used to ask for the document's raw id — a UUID that appears
 * nowhere a plant owner would look — and for the field name as the database
 * spells it ("vehicle_no"). Nobody was ever going to fill that in, so the
 * correction trail stayed empty while implying it was complete. The document is
 * now picked from a list by its number, the way it is referred to everywhere
 * else.
 */
const DOC_TYPES: { value: string; label: string; load: () => Promise<Row[]> }[] = [
  { value: 'invoice', label: 'Invoice', load: () => invoicesApi.list(undefined, 200) },
  { value: 'delivery_challan', label: 'Delivery challan', load: () => challansApi.list(undefined, 200) },
  { value: 'vendor_bill', label: 'Supplier bill', load: () => purchaseApi.bills(undefined, 200) },
  { value: 'expense_voucher', label: 'Expense voucher', load: () => expensesApi.vouchers(undefined, 200) },
  { value: 'order', label: 'Order', load: () => ordersApi.list(undefined, 200) },
  { value: 'quotation', label: 'Quotation', load: () => quotationsApi.list(200) },
];

/** A document's own number, whatever this kind of document calls it. */
function documentNumber(r: Row): string {
  const v =
    r.invoiceNo ?? r.challanNo ?? r.billNo ?? r.supplierBillNo ?? r.voucherNo ?? r.orderNo ?? r.quotationNo;
  return v == null || String(v).trim() === '' ? String(r.id ?? '') : String(v);
}

export default function CorrectionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const win = useListWindow();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [documentType, setDocumentType] = useState('invoice');
  const [docs, setDocs] = useState<Row[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [documentLabel, setDocumentLabel] = useState('');
  const [field, setField] = useState('');
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');

  const canManage = getAccess().has('document_corrections.manage');

  async function reload() {
    setRows(await correctionsApi.list(filterType || undefined, undefined, win.limit));
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
    // filter drives reload
  }, [filterType, win.limit]);

  // Load the documents of the chosen kind so one can be picked by its number.
  useEffect(() => {
    const type = DOC_TYPES.find((t) => t.value === documentType);
    setDocumentId('');
    setDocumentLabel('');
    setDocs([]);
    setDocsError(null);
    if (!type || !canManage) return;
    let live = true;
    type
      .load()
      .then((list) => { if (live) setDocs(Array.isArray(list) ? list : []); })
      .catch((e) => { if (live) setDocsError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [documentType, canManage]);

  async function record() {
    setError(null); setMsg(null);
    if (!documentId.trim()) { setError('Enter the document id being corrected'); return; }
    if (!field.trim()) { setError('Enter the field that changed'); return; }
    setBusy(true);
    try {
      await correctionsApi.record({
        documentType, documentId: documentId.trim(), documentLabel: documentLabel || undefined,
        field: field.trim(), oldValue: oldValue || undefined, newValue: newValue || undefined, reason: reason || undefined,
      });
      setMsg(`Correction recorded on ${documentLabel || documentId}.`);
      setDocumentId(''); setDocumentLabel(''); setField(''); setOldValue(''); setNewValue(''); setReason('');
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Document Corrections</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>
        Note an amendment to a document you have already posted — what changed, from what to what, and
        why — so there is a record of the correction and the reason for it. Changes you make in the app
        are already recorded on their own in the <a href="/app/audit">Audit trail</a>; this is for
        amendments agreed outside it, with a customer or your accountant.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canManage && (
        <div style={{ marginBottom: 18 }}>
          <Card title="Record a correction">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 160 }}>
                <Field label="Document type">
                  <select className="mn-input" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                    {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 240 }}>
                <Field
                  label="Document"
                  required
                  help={docsError ? `Could not load the list: ${docsError}` : undefined}
                >
                  <select
                    className="mn-input"
                    value={documentId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setDocumentId(id);
                      const hit = docs.find((d) => String(d.id) === id);
                      setDocumentLabel(hit ? documentNumber(hit) : '');
                    }}
                  >
                    <option value="">{docs.length ? 'Choose one…' : 'No documents of this kind yet'}</option>
                    {docs.map((d) => (
                      <option key={String(d.id)} value={String(d.id)}>{documentNumber(d)}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 170 }}>
                <Field label="What changed" required>
                  <Input value={field} placeholder="Vehicle number" onChange={(e) => setField(e.target.value)} />
                </Field>
              </div>
              <div style={{ minWidth: 130 }}><Field label="Old value"><Input value={oldValue} onChange={(e) => setOldValue(e.target.value)} /></Field></div>
              <div style={{ minWidth: 130 }}><Field label="New value"><Input value={newValue} onChange={(e) => setNewValue(e.target.value)} /></Field></div>
              <div style={{ minWidth: 180, flex: 1 }}><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
              <Button onClick={record} loading={busy}>Record</Button>
            </div>
          </Card>
        </div>
      )}

      <Card title="Correction trail" padded={false}
        actions={
          <select className="mn-input" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All documents</option>
            {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        }
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead><tr><Th>When</Th><Th>Document</Th><Th>Field</Th><Th>Old → New</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <Td>{String(r.createdAt ?? '').slice(0, 19).replace('T', ' ')}</Td>
                  <Td>{String(r.documentLabel ?? r.documentType)}</Td>
                  <Td>{String(r.field)}</Td>
                  <Td>{String(r.oldValue ?? '—')} → {String(r.newValue ?? '—')}</Td>
                  <Td>{String(r.reason ?? '—')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No corrections yet" description={canManage ? 'Record the first amendment above.' : 'Nothing to show.'} />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="corrections" />
      </Card>
    </div>
  );
}
