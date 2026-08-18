'use client';

import { useEffect, useState } from 'react';
import { crud, purchaseApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

interface LineDraft { materialId: string; quantity: string; rate: string; gstRate: string }
const emptyLine = (): LineDraft => ({ materialId: '', quantity: '', rate: '', gstRate: '18' });

export default function PurchaseOrdersPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [plantId, setPlantId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const canCreate = getAccess().has('purchase_orders.create');
  const canReceive = getAccess().has('grn.create');

  async function reload() {
    const [o, s, mt, p] = await Promise.all([
      purchaseApi.orders(), crud('suppliers').list(), crud('materials').list(), crud('plants').list(),
    ]);
    setRows(o); setSuppliers(s); setMaterials(mt); setPlants(p);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoaded(true));
  }, []);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    setError(null); setMsg(null);
    const payloadLines = lines
      .filter((l) => l.materialId && Number(l.quantity) > 0)
      .map((l) => {
        const material = materials.find((mt) => String(mt.id) === l.materialId);
        return {
          materialId: l.materialId, materialLabel: material?.materialName, uom: material?.uom,
          quantity: Number(l.quantity), rate: Number(l.rate || 0), gstRate: Number(l.gstRate || 0),
        };
      });
    if (!supplierId) { setError('Select a supplier'); return; }
    if (!payloadLines.length) { setError('Add at least one line with a material and quantity'); return; }
    setBusy(true);
    try {
      const po = await purchaseApi.createOrder({ supplierId, plantId: plantId || undefined, orderDate: new Date().toISOString().slice(0, 10), lines: payloadLines });
      setMsg(`Purchase order ${String(po.poNo)} created (₹${money(po.totalAmount)}).`);
      setSupplierId(''); setPlantId(''); setLines([emptyLine()]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null); setMsg(null);
    try { await fn(); await reload(); setMsg(okMsg); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  /** Receive everything still outstanding on a PO: build a GRN from the remaining
   *  quantities, create it and post it (which increases stock). */
  async function receive(poId: string) {
    const po = await purchaseApi.order(poId);
    const items = (po.items as Row[]) ?? [];
    const grnLines = items
      .map((it) => ({ it, remaining: Number(it.quantity) - Number(it.receivedQuantity) }))
      .filter((x) => x.remaining > 0.0005)
      .map(({ it, remaining }) => ({
        purchaseOrderItemId: String(it.id), materialId: it.materialId, materialLabel: it.materialLabel,
        uom: it.uom, receivedQuantity: remaining, acceptedQuantity: remaining, rate: Number(it.rate),
      }));
    if (!grnLines.length) { setError('Nothing left to receive on this PO'); return; }
    if (!(await confirm({ title: 'Receive goods', message: `Receive the outstanding quantity on ${String(po.poNo)} and post it to stock?`, confirmLabel: 'Receive & post' }))) return;
    await act(async () => {
      const grn = await purchaseApi.createGrn({ purchaseOrderId: poId, plantId: po.plantId ?? undefined, receiptDate: new Date().toISOString().slice(0, 10), lines: grnLines });
      await purchaseApi.postGrn(String(grn.id));
    }, 'Goods received and posted to stock.');
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Purchase Orders</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Raise a purchase order to a supplier, then receive goods against it into stock.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canCreate && (
        <div style={{ marginBottom: 18 }}>
          <Card title="New purchase order">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ minWidth: 220 }}>
                <Field label="Supplier" required>
                  <select className="mn-input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">— select —</option>
                    {suppliers.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.supplierName)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 180 }}>
                <Field label="Plant">
                  <select className="mn-input" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                    <option value="">— default —</option>
                    {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <Table>
              <thead>
                <tr><Th>Material</Th><Th numeric>Quantity</Th><Th numeric>Rate</Th><Th numeric>GST %</Th><Th /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <Td>
                      <select className="mn-input" value={l.materialId} onChange={(e) => setLine(i, { materialId: e.target.value })}>
                        <option value="">— select —</option>
                        {materials.map((mt) => <option key={String(mt.id)} value={String(mt.id)}>{String(mt.materialName)}</option>)}
                      </select>
                    </Td>
                    <Td numeric><Input type="number" step="any" style={{ width: 110, textAlign: 'right' }} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></Td>
                    <Td numeric><Input type="number" step="any" style={{ width: 110, textAlign: 'right' }} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></Td>
                    <Td numeric><Input type="number" step="any" style={{ width: 80, textAlign: 'right' }} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })} /></Td>
                    <Td>{lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>Remove</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="secondary" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>Add line</Button>
              <Button onClick={create} loading={busy}>Create order</Button>
            </div>
          </Card>
        </div>
      )}

      <Card title="Purchase orders" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr><Th>PO No</Th><Th>Date</Th><Th numeric>Total</Th><Th>Status</Th><Th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = String(r.status);
                return (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600 }}>{String(r.poNo)}</Td>
                    <Td>{String(r.orderDate ?? '—')}</Td>
                    <Td numeric>₹{money(r.totalAmount)}</Td>
                    <Td><StatusBadge status={status} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canCreate && status === 'draft' && (
                          <Button variant="secondary" size="sm" onClick={() => act(() => purchaseApi.issueOrder(String(r.id)), `PO ${String(r.poNo)} issued.`)}>Issue</Button>
                        )}
                        {canReceive && (status === 'issued' || status === 'partially_received') && (
                          <Button variant="secondary" size="sm" onClick={() => receive(String(r.id))}>Receive</Button>
                        )}
                        {canCreate && status === 'draft' && (
                          <Button variant="ghost" size="sm" onClick={() => act(() => purchaseApi.cancelOrder(String(r.id)), `PO ${String(r.poNo)} cancelled.`)}>Cancel</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No purchase orders yet" description={canCreate ? 'Raise your first PO above.' : 'Nothing to show.'} />
        )}
      </Card>
    </div>
  );
}
