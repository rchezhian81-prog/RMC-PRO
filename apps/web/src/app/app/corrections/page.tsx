'use client';

import { useEffect, useState } from 'react';
import { correctionsApi, type Row } from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

const DOC_TYPES = ['invoice', 'delivery_challan', 'vendor_bill', 'expense_voucher', 'order', 'quotation'];

export default function CorrectionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [documentType, setDocumentType] = useState('invoice');
  const [documentId, setDocumentId] = useState('');
  const [documentLabel, setDocumentLabel] = useState('');
  const [field, setField] = useState('');
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');

  const canManage = getAccess().has('document_corrections.manage');

  async function reload() {
    setRows(await correctionsApi.list(filterType || undefined));
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // filter drives reload
  }, [filterType]);

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
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Record an amendment to a posted document — what changed, from what to what, and why. Each correction is also written to the audit trail.</p>
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
                    {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 220 }}><Field label="Document id" required><Input value={documentId} onChange={(e) => setDocumentId(e.target.value)} /></Field></div>
              <div style={{ minWidth: 140 }}><Field label="Document no."><Input value={documentLabel} placeholder="INV-0007" onChange={(e) => setDocumentLabel(e.target.value)} /></Field></div>
              <div style={{ minWidth: 140 }}><Field label="Field" required><Input value={field} placeholder="vehicle_no" onChange={(e) => setField(e.target.value)} /></Field></div>
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
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        }
      >
        {rows.length ? (
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
      </Card>
    </div>
  );
}
