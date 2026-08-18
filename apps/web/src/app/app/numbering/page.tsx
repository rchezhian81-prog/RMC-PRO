'use client';

import { useEffect, useState } from 'react';
import { crud, numberingApi, type Row } from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { StatusBadge } from '../../../components/ui/Badge';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

const DOC_TYPES = ['quotation', 'order', 'delivery_challan', 'invoice', 'receipt', 'dispatch'];

export default function NumberingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [documentType, setDocumentType] = useState('delivery_challan');
  const [count, setCount] = useState('10');
  const [plantId, setPlantId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = getAccess().has('sync.manage');

  async function reload() {
    const [r, p] = await Promise.all([numberingApi.reservations(), crud('plants').list()]);
    setRows(r); setPlants(p);
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function reserve() {
    setError(null); setMsg(null);
    if (!documentType.trim()) { setError('Choose a document type'); return; }
    if (!(Number(count) > 0)) { setError('Enter how many numbers to reserve'); return; }
    setBusy(true);
    try {
      const res = await numberingApi.reserve({ documentType: documentType.trim(), count: Number(count), plantId: plantId || undefined });
      setMsg(`Reserved ${String(res.sampleFrom)} – ${String(res.sampleTo)} for ${String(res.documentType)}${res.financialYear ? ` (FY ${String(res.financialYear)})` : ''}.`);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const plantName = (id: unknown) => String(plants.find((p) => String(p.id) === String(id))?.plantName ?? '—');

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Document Numbering</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Reserve a block of document numbers (for an offline plant or a manual book). Series reset each financial year; a plant reserves from its own series.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canManage && (
        <div style={{ marginBottom: 18 }}>
          <Card title="Reserve a number block">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 190 }}>
                <Field label="Document type">
                  <select className="mn-input" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                    {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ width: 120 }}><Field label="Count"><Input type="number" step="1" value={count} onChange={(e) => setCount(e.target.value)} /></Field></div>
              <div style={{ minWidth: 180 }}>
                <Field label="Plant (optional)">
                  <select className="mn-input" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                    <option value="">— tenant-wide —</option>
                    {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
                  </select>
                </Field>
              </div>
              <Button onClick={reserve} loading={busy}>Reserve</Button>
            </div>
          </Card>
        </div>
      )}

      <Card title="Reserved number blocks" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rows.length ? (
          <Table>
            <thead><tr><Th>When</Th><Th>Document</Th><Th>Plant</Th><Th numeric>From</Th><Th numeric>To</Th><Th numeric>Used</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <Td>{String(r.createdAt ?? '').slice(0, 19).replace('T', ' ')}</Td>
                  <Td>{String(r.documentType)}</Td>
                  <Td>{r.plantId ? plantName(r.plantId) : 'tenant-wide'}</Td>
                  <Td numeric>{String(r.numberFrom)}</Td>
                  <Td numeric>{String(r.numberTo)}</Td>
                  <Td numeric>{String(r.usedCount)}</Td>
                  <Td><StatusBadge status={String(r.status)} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No reservations yet" description={canManage ? 'Reserve a block above.' : 'Nothing to show.'} />
        )}
      </Card>
    </div>
  );
}
