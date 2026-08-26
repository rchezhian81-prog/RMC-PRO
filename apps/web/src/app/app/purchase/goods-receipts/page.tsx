'use client';

import { useEffect, useState } from 'react';
import { purchaseApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type GrnLine = {
  poItemId: string; materialId: string; materialLabel: string; uom: string;
  ordered: number; remaining: number; received: string; accepted: string; rate: number;
};

export default function GoodsReceiptsPage() {
  const { confirm } = useConfirm();
  const canCreate = getAccess().has('grn.create');
  const [rows, setRows] = useState<Row[]>([]);
  const [openPos, setOpenPos] = useState<Row[]>([]);
  const [poId, setPoId] = useState('');
  const [po, setPo] = useState<Row | null>(null);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [head, setHead] = useState({ supplierChallanNo: '', vehicleNo: '', receiptDate: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => setRows(await purchaseApi.grns());

  useEffect(() => {
    Promise.all([purchaseApi.grns(), purchaseApi.orders()])
      .then(([g, o]) => {
        setRows(g);
        setOpenPos((o as Row[]).filter((p) => ['issued', 'partially_received'].includes(String(p.status))));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
    // Preselect a PO passed as ?po=… (from the Purchase Orders "Receive" action).
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('po') : null;
    if (q) pickPo(q);
  }, []);

  async function pickPo(id: string) {
    setPoId(id);
    setError(null);
    setMsg(null);
    if (!id) { setPo(null); setLines([]); return; }
    try {
      const full = await purchaseApi.order(id);
      setPo(full);
      const items = (full.items as Row[]) ?? [];
      setLines(
        items
          .map((it) => {
            const ordered = Number(it.quantity);
            const remaining = Math.max(0, ordered - Number(it.receivedQuantity));
            return {
              poItemId: String(it.id), materialId: String(it.materialId ?? ''),
              materialLabel: String(it.materialLabel ?? ''), uom: String(it.uom ?? ''),
              ordered, remaining, received: String(remaining), accepted: String(remaining), rate: Number(it.rate),
            };
          })
          .filter((l) => l.remaining > 0.0005),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the purchase order');
    }
  }

  const setLine = (i: number, patch: Partial<GrnLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function create() {
    setError(null);
    setMsg(null);
    const payloadLines = lines
      .map((l) => ({
        purchaseOrderItemId: l.poItemId, materialId: l.materialId, materialLabel: l.materialLabel, uom: l.uom,
        receivedQuantity: Number(l.received || 0), acceptedQuantity: Number(l.accepted || 0), rate: l.rate,
      }))
      .filter((l) => l.receivedQuantity > 0);
    if (!payloadLines.length) { setError('Enter a received quantity on at least one line.'); return; }
    if (payloadLines.some((l) => l.acceptedQuantity > l.receivedQuantity + 0.0005)) {
      setError('Accepted quantity cannot exceed the received quantity.');
      return;
    }
    setBusy(true);
    try {
      const grn = await purchaseApi.createGrn({
        purchaseOrderId: poId, plantId: po?.plantId ?? undefined,
        receiptDate: head.receiptDate || new Date().toISOString().slice(0, 10),
        supplierChallanNo: head.supplierChallanNo || undefined, vehicleNo: head.vehicleNo || undefined,
        lines: payloadLines,
      });
      setMsg(`Goods receipt ${String(grn.grnNo)} created as a draft — post it to add the accepted quantity to stock.`);
      setPoId(''); setPo(null); setLines([]); setHead({ supplierChallanNo: '', vehicleNo: '', receiptDate: '' });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function postGrn(id: string, grnNo: string) {
    if (!(await confirm({ title: 'Post goods receipt', message: `Post ${grnNo} and add the accepted quantities to stock? This cannot be undone.`, confirmLabel: 'Post to stock' }))) return;
    setError(null);
    setMsg(null);
    try {
      await purchaseApi.postGrn(id);
      setMsg(`${grnNo} posted to stock.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Goods Receipts (GRN)</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>
        Record what actually arrived against a purchase order — supplier challan, vehicle, and the received vs accepted
        quantity per line. Posting a receipt adds the accepted quantity to stock.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canCreate && (
        <div style={{ marginBottom: 18 }}>
          <Card title="New goods receipt">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: lines.length ? 14 : 0 }}>
              <div style={{ minWidth: 220 }}>
                <Field label="Purchase order">
                  <select className="mn-input" value={poId} onChange={(e) => pickPo(e.target.value)}>
                    <option value="">— select a PO to receive —</option>
                    {openPos.map((p) => (
                      <option key={p.id} value={String(p.id)}>{String(p.poNo)}{p.supplierName ? ` · ${String(p.supplierName)}` : ''}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 150 }}><Field label="Supplier challan no"><Input value={head.supplierChallanNo} onChange={(e) => setHead({ ...head, supplierChallanNo: e.target.value })} /></Field></div>
              <div style={{ minWidth: 130 }}><Field label="Vehicle no"><Input value={head.vehicleNo} onChange={(e) => setHead({ ...head, vehicleNo: e.target.value })} /></Field></div>
              <div style={{ minWidth: 150 }}><Field label="Receipt date"><Input type="date" value={head.receiptDate} onChange={(e) => setHead({ ...head, receiptDate: e.target.value })} /></Field></div>
            </div>

            {poId && (lines.length ? (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Material</Th>
                      <Th numeric>Ordered</Th>
                      <Th numeric>Remaining</Th>
                      <Th numeric>Received</Th>
                      <Th numeric>Accepted</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.poItemId}>
                        <Td>{l.materialLabel}{l.uom ? ` (${l.uom})` : ''}</Td>
                        <Td numeric>{qty(l.ordered)}</Td>
                        <Td numeric>{qty(l.remaining)}</Td>
                        <Td numeric><Input type="number" step="any" style={{ width: 110, textAlign: 'right' }} value={l.received} onChange={(e) => setLine(i, { received: e.target.value })} /></Td>
                        <Td numeric><Input type="number" step="any" style={{ width: 110, textAlign: 'right' }} value={l.accepted} onChange={(e) => setLine(i, { accepted: e.target.value })} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div style={{ marginTop: 14 }}>
                  <Button onClick={create} disabled={busy}>Create goods receipt</Button>
                  <span style={{ color: 'var(--mn-muted)', fontSize: 12, marginLeft: 10 }}>Saved as a draft — post it below to update stock.</span>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--mn-muted)', fontSize: 13 }}>Nothing left to receive on this purchase order.</p>
            ))}
          </Card>
        </div>
      )}

      <Card title="Goods receipts" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>GRN No</Th>
                <Th>Date</Th>
                <Th>Challan</Th>
                <Th>Vehicle</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = String(r.status);
                return (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600 }}>{String(r.grnNo ?? '')}</Td>
                    <Td>{String(r.receiptDate ?? '')}</Td>
                    <Td>{String(r.supplierChallanNo ?? '—')}</Td>
                    <Td>{String(r.vehicleNo ?? '—')}</Td>
                    <Td><StatusBadge status={status} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      {canCreate && status === 'draft' && (
                        <Button variant="secondary" size="sm" onClick={() => postGrn(String(r.id), String(r.grnNo))}>Post to stock</Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No goods receipts" description="Receive a purchase order above to record a GRN." />
        )}
      </Card>
    </div>
  );
}
