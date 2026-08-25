'use client';

import { useEffect, useState } from 'react';
import { crud, customersApi, invoicesApi, receiptsApi, type CustomerExposure, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function ReceiptsPage() {
  const { prompt, confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [openInvoices, setOpenInvoices] = useState<Row[]>([]);
  const [exposure, setExposure] = useState<CustomerExposure | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ amount: '', paymentMode: 'neft', receiptDate: '', bankReference: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [r, c] = await Promise.all([receiptsApi.list(), crud('customers').list()]);
    setRows(r);
    setCustomers(c);
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function pickCustomer(cid: string) {
    setCustomerId(cid);
    setAlloc({});
    setError(null);
    setMsg(null);
    if (!cid) {
      setOpenInvoices([]);
      setExposure(null);
      return;
    }
    const [all, exp] = await Promise.all([
      invoicesApi.list('issued'),
      customersApi.exposure(cid).catch(() => null),
    ]);
    setOpenInvoices(all.filter((i) => i.customerId === cid && Number(i.outstandingAmount) > 0));
    setExposure(exp);
  }

  /** Run a receipt action, then refresh and report — errors surface inline. */
  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function create() {
    setError(null);
    setMsg(null);
    const allocations = openInvoices
      .map((i) => ({ invoiceId: String(i.id), amount: Number(alloc[String(i.id)] || 0) }))
      .filter((a) => a.amount > 0);
    try {
      const r = await receiptsApi.create({
        customerId,
        amount: Number(form.amount || 0),
        paymentMode: form.paymentMode,
        receiptDate: form.receiptDate || undefined,
        bankReference: form.bankReference || undefined,
        allocations,
      });
      setMsg(`Receipt ${String(r.receiptNo)} recorded (allocated ₹${money(r.allocatedAmount)}, unallocated ₹${money(r.unallocatedAmount)}).`);
      setForm({ amount: '', paymentMode: 'neft', receiptDate: '', bankReference: '' });
      setCustomerId('');
      setOpenInvoices([]);
      setExposure(null);
      setAlloc({});
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Receipts</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Record a customer payment and allocate it against outstanding invoices.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="New receipt">
          <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: customerId ? 14 : 0 }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Customer">
                <select className="mn-input" value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
                  <option value="">— select —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 130 }}>
              <Field label="Amount">
                <Input type="number" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 110 }}>
              <Field label="Mode">
                <select className="mn-input" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
                  {['neft', 'rtgs', 'upi', 'cheque', 'cash'].map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Date">
                <Input type="date" value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 130 }}>
              <Field label="Bank ref">
                <Input value={form.bankReference} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} />
              </Field>
            </div>
          </div>

          {customerId && exposure && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
              <StatCard label="Exposure" value={'₹' + money(exposure.exposure)} tone="info" />
              <StatCard label="Invoice outstanding" value={'₹' + money(exposure.invoiceOutstanding)} />
              <StatCard
                label="Advance on account"
                value={'₹' + money(exposure.advanceCredit)}
                tone={exposure.advanceCredit > 0 ? 'success' : 'neutral'}
              />
              <StatCard
                label="Available credit"
                value={exposure.availableCredit === null ? 'No limit' : '₹' + money(exposure.availableCredit)}
                tone={exposure.availableCredit !== null && exposure.availableCredit < 0 ? 'danger' : 'neutral'}
              />
            </div>
          )}

          {customerId &&
            (openInvoices.length ? (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Invoice</Th>
                      <Th numeric>Total</Th>
                      <Th numeric>Outstanding</Th>
                      <Th numeric>Allocate</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((i) => (
                      <tr key={i.id}>
                        <Td>{String(i.invoiceNo)}</Td>
                        <Td numeric>{money(i.totalAmount)}</Td>
                        <Td numeric>{money(i.outstandingAmount)}</Td>
                        <Td numeric>
                          <Input type="number" step="any" style={{ width: 120, textAlign: 'right' }} value={alloc[String(i.id)] ?? ''} onChange={(e) => setAlloc({ ...alloc, [String(i.id)]: e.target.value })} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div style={{ marginTop: 14 }}>
                  <Button onClick={create}>Record receipt</Button>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--mn-muted)', fontSize: 13 }}>No outstanding invoices for this customer.</p>
            ))}
        </Card>
      </div>

      <Card title="Receipts" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Receipt No</Th>
                <Th>Date</Th>
                <Th>Mode</Th>
                <Th numeric>Amount</Th>
                <Th numeric>Allocated</Th>
                <Th numeric>Unallocated</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const reversed = String(r.status) === 'reversed';
                const clearing = String(r.clearingStatus ?? '');
                const canBounce = !reversed && (clearing === 'pending' || clearing === 'realised');
                const canApply = !reversed && Number(r.unallocatedAmount) > 0;
                return (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.receiptNo ?? '')}</Td>
                  <Td>{String(r.receiptDate ?? '—')}</Td>
                  <Td>{String(r.paymentMode ?? '')}</Td>
                  <Td numeric>₹{money(r.amount)}</Td>
                  <Td numeric>₹{money(r.allocatedAmount)}</Td>
                  <Td numeric>₹{money(r.unallocatedAmount)}</Td>
                  <Td><StatusBadge status={clearing || String(r.status ?? '')} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {clearing === 'pending' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => act(() => receiptsApi.realise(String(r.id)), `Receipt ${String(r.receiptNo)} marked realised.`)}
                        >
                          Realise
                        </Button>
                      )}
                      {canApply && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => act(() => receiptsApi.apply(String(r.id)), `Applied advance on ${String(r.receiptNo)}.`)}
                        >
                          Apply advance
                        </Button>
                      )}
                      {canBounce && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            act(async () => {
                              if (!(await confirm({ title: 'Bounce cheque', message: `Reverse receipt ${String(r.receiptNo)}? Every allocation is restored to its invoice.`, confirmLabel: 'Bounce' }))) return;
                              const reason = await prompt({ title: 'Bounce cheque', label: 'Reason', defaultValue: '' });
                              if (reason === null) return;
                              await receiptsApi.bounce(String(r.id), reason);
                            }, `Receipt ${String(r.receiptNo)} reversed.`)
                          }
                        >
                          Bounce
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          const m = await prompt({ title: 'Share receipt', label: 'Recipient mobile', defaultValue: '' });
                          if (m !== null) {
                            await receiptsApi.share(String(r.id), m);
                            setMsg('WhatsApp message logged.');
                          }
                        }}
                      >
                        Share
                      </Button>
                    </div>
                  </Td>
                </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No receipts yet" description="Record a customer payment above." />
        )}
      </Card>
    </div>
  );
}
