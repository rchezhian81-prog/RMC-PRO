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

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function VendorBillsPage() {
  const { confirm, prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [grns, setGrns] = useState<Row[]>([]);
  const [grnId, setGrnId] = useState('');
  const [supplierBillNo, setSupplierBillNo] = useState('');
  const [itcEligible, setItcEligible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const canCreate = getAccess().has('vendor_bills.create');
  const canApprove = getAccess().has('vendor_bills.approve');
  const canPay = getAccess().has('vendor_payments.create');

  async function reload() {
    const [b, g, p] = await Promise.all([purchaseApi.bills(), purchaseApi.grns('posted'), purchaseApi.payments()]);
    setRows(b); setGrns(g); setPayments(p);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoaded(true));
  }, []);

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null); setMsg(null);
    try { await fn(); await reload(); setMsg(okMsg); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function createBill() {
    setError(null); setMsg(null);
    const grn = grns.find((g) => String(g.id) === grnId);
    if (!grn) { setError('Select a posted goods receipt'); return; }
    setBusy(true);
    try {
      const bill = await purchaseApi.createBill({
        supplierId: grn.supplierId, goodsReceiptId: grn.id, purchaseOrderId: grn.purchaseOrderId ?? undefined,
        supplierBillNo: supplierBillNo || undefined, billDate: new Date().toISOString().slice(0, 10),
        itcEligible,
      });
      setMsg(`Vendor bill ${String(bill.billNo)} created — match: ${String(bill.matchStatus)}.`);
      setGrnId(''); setSupplierBillNo(''); setItcEligible(true);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function pay(bill: Row) {
    const outstanding = Number(bill.outstandingAmount);
    if (!(outstanding > 0)) return;
    if (!(await confirm({ title: 'Pay vendor bill', message: `Record a payment of ₹${money(outstanding)} to settle ${String(bill.billNo)}?`, confirmLabel: 'Pay' }))) return;
    await act(
      () => purchaseApi.createPayment({ supplierId: bill.supplierId, amount: outstanding, paymentMode: 'neft', allocations: [{ billId: bill.id, amount: outstanding }] }),
      `Paid ₹${money(outstanding)} against ${String(bill.billNo)}.`,
    );
  }

  async function reverse(payment: Row) {
    const reason = await prompt({
      title: 'Reverse vendor payment',
      message: `Reverse ${String(payment.paymentNo)} (₹${money(payment.amount)})? Each bill it paid is restored to its outstanding.`,
      label: 'Reason (optional)', placeholder: 'e.g. allocated to the wrong bill', confirmLabel: 'Reverse',
    });
    if (reason === null) return; // cancelled
    await act(() => purchaseApi.reversePayment(String(payment.id), reason || undefined), `Payment ${String(payment.paymentNo)} reversed.`);
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Vendor Bills</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Raise a vendor bill from a received GRN (3-way matched against the PO), approve it, and pay it.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canCreate && (
        <div style={{ marginBottom: 18 }}>
          <Card title="New vendor bill (from a goods receipt)">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 240 }}>
                <Field label="Goods receipt" required>
                  <select className="mn-input" value={grnId} onChange={(e) => setGrnId(e.target.value)}>
                    <option value="">— select a posted GRN —</option>
                    {grns.map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.grnNo)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 180 }}>
                <Field label="Supplier bill no">
                  <Input value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} />
                </Field>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--mn-muted)', whiteSpace: 'nowrap' }} title="Uncheck for a blocked credit (Sec 17(5)) — its GST is excluded from the ITC register and GSTR-3B.">
                  <input type="checkbox" checked={itcEligible} onChange={(e) => setItcEligible(e.target.checked)} />
                  ITC eligible
                </label>
              </div>
              <div style={{ marginBottom: 14 }}>
                <Button onClick={createBill} loading={busy}>Create bill</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card title="Vendor bills" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Bill No</Th>
                <Th>Supplier Bill</Th>
                <Th numeric>Total</Th>
                <Th numeric>Outstanding</Th>
                <Th>Match</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = String(r.status);
                const outstanding = Number(r.outstandingAmount);
                return (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600 }}>{String(r.billNo)}</Td>
                    <Td>
                      {String(r.supplierBillNo ?? '—')}
                      {r.itcEligible === false && <span style={{ marginLeft: 6 }}><StatusBadge status="blocked" /></span>}
                    </Td>
                    <Td numeric>₹{money(r.totalAmount)}</Td>
                    <Td numeric>₹{money(r.outstandingAmount)}</Td>
                    <Td>{r.matchStatus ? <StatusBadge status={String(r.matchStatus)} /> : '—'}</Td>
                    <Td><StatusBadge status={status === 'approved' ? String(r.paymentStatus) : status} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canApprove && status === 'draft' && (
                          <Button variant="secondary" size="sm" onClick={() => act(() => purchaseApi.approveBill(String(r.id)), `Bill ${String(r.billNo)} approved.`)}>Approve</Button>
                        )}
                        {canPay && status === 'approved' && outstanding > 0.001 && (
                          <Button variant="secondary" size="sm" onClick={() => pay(r)}>Pay</Button>
                        )}
                        {canApprove && status === 'draft' && (
                          <Button variant="ghost" size="sm" onClick={async () => { if (!(await confirm({ title: 'Cancel vendor bill', message: `Cancel bill ${String(r.billNo)}? This cannot be undone.`, confirmLabel: 'Cancel bill', danger: true }))) return; act(() => purchaseApi.cancelBill(String(r.id)), `Bill ${String(r.billNo)} cancelled.`); }}>Cancel</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No vendor bills yet" description={canCreate ? 'Create one from a posted goods receipt above.' : 'Nothing to show.'} />
        )}
      </Card>

      <div style={{ marginTop: 18 }}>
        <Card title="Vendor payments" padded={false}>
          {!loaded ? (
            <TableSkeleton cols={5} />
          ) : payments.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Payment No</Th>
                  <Th numeric>Amount</Th>
                  <Th numeric>Allocated</Th>
                  <Th numeric>Unallocated</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const pstatus = String(p.status ?? 'posted');
                  return (
                    <tr key={p.id}>
                      <Td style={{ fontWeight: 600 }}>{String(p.paymentNo)}</Td>
                      <Td numeric>₹{money(p.amount)}</Td>
                      <Td numeric>₹{money(p.allocatedAmount)}</Td>
                      <Td numeric>{Number(p.unallocatedAmount) > 0.001 ? <b>₹{money(p.unallocatedAmount)}</b> : `₹${money(p.unallocatedAmount)}`}</Td>
                      <Td><StatusBadge status={pstatus} /></Td>
                      <Td style={{ textAlign: 'right' }}>
                        {canPay && pstatus === 'posted' && (
                          <Button variant="ghost" size="sm" onClick={() => reverse(p)}>Reverse</Button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No payments yet" description="Payments recorded against approved bills appear here." />
          )}
        </Card>
      </div>
    </div>
  );
}
