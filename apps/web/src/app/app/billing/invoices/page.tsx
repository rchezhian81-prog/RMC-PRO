'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { crud, invoicesApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

interface LineForm { challanId: string; challanNo: string; quantity: number; hsnSac: string; uom: string; rate: string; gstRate: string; }

export default function InvoicesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineForm[]>([]);
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg] = useState<string | null>(null);

  async function reload() {
    const [inv, c] = await Promise.all([invoicesApi.list(), crud('customers').list()]);
    setRows(inv);
    setCustomers(c);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function loadBillable(cid: string) {
    setCustomerId(cid);
    setLines([]);
    setError(null);
    if (!cid) return;
    try {
      const challans = await invoicesApi.billableChallans(cid);
      setLines(
        challans.map((c) => ({ challanId: String(c.id), challanNo: String(c.challanNo), quantity: Number(c.quantityM3), hsnSac: '68109990', uom: 'm3', rate: '', gstRate: '18' })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  function setLine(i: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    setError(null);
    const use = lines.filter((l) => Number(l.rate) > 0);
    if (!customerId || !use.length) {
      setError('Pick a customer and set a rate on at least one challan');
      return;
    }
    try {
      const inv = await invoicesApi.fromChallans({
        customerId,
        invoiceDate: invoiceDate || undefined,
        dueDate: dueDate || undefined,
        lines: use.map((l) => ({ challanId: l.challanId, hsnSac: l.hsnSac, uom: l.uom, rate: Number(l.rate), gstRate: Number(l.gstRate) })),
      });
      router.push(`/app/billing/invoices/${inv.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Invoices</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px', maxWidth: 760 }}>Generate a GST tax invoice from delivered challans. Challans flip to invoiced on creation.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="New invoice from delivered challans">
          <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: lines.length || customerId ? 14 : 0 }}>
            <div style={{ minWidth: 220 }}>
              <Field label="Customer">
                <select className="mn-input" value={customerId} onChange={(e) => loadBillable(e.target.value)}>
                  <option value="">— select —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Invoice date">
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Due date">
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
          </div>

          {customerId &&
            (lines.length ? (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Challan</Th>
                      <Th numeric>Qty</Th>
                      <Th>HSN/SAC</Th>
                      <Th>UOM</Th>
                      <Th numeric>Rate</Th>
                      <Th numeric>GST%</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.challanId}>
                        <Td>{l.challanNo}</Td>
                        <Td numeric>{money(l.quantity)}</Td>
                        <Td><Input style={{ width: 110 }} value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} /></Td>
                        <Td><Input style={{ width: 64 }} value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })} /></Td>
                        <Td numeric><Input type="number" step="any" style={{ width: 96, textAlign: 'right' }} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></Td>
                        <Td numeric><Input type="number" step="any" style={{ width: 74, textAlign: 'right' }} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div style={{ marginTop: 14 }}>
                  <Button onClick={create}>Create invoice</Button>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--mn-muted)', fontSize: 13 }}>No delivered, un-invoiced challans for this customer.</p>
            ))}
        </Card>
      </div>

      <Card title="Invoices" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Invoice No</Th>
                <Th>Date</Th>
                <Th numeric>Taxable</Th>
                <Th numeric>Total</Th>
                <Th numeric>Outstanding</Th>
                <Th>Payment</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.invoiceNo ?? '')}</Td>
                  <Td>{String(r.invoiceDate ?? '—')}</Td>
                  <Td numeric>₹{money(r.taxableAmount)}</Td>
                  <Td numeric>₹{money(r.totalAmount)}</Td>
                  <Td numeric>₹{money(r.outstandingAmount)}</Td>
                  <Td><StatusBadge status={String(r.paymentStatus ?? '')} /></Td>
                  <Td><StatusBadge status={String(r.invoiceStatus)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Link href={`/app/billing/invoices/${r.id}`}>
                      <Button variant="secondary" size="sm">Open</Button>
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No invoices yet" description="Create an invoice from delivered challans above." />
        )}
      </Card>
    </div>
  );
}
