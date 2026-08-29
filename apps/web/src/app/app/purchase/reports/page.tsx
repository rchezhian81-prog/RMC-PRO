'use client';

import { useEffect, useState } from 'react';
import { crud, purchaseReportsApi, type Row, type VendorLedger } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function PurchaseReportsPage() {
  const [aging, setAging] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [register, setRegister] = useState<{ rows: Row[]; byVendor: Row[]; byMaterial: Row[]; totals: Row } | null>(null);
  const [ledger, setLedger] = useState<VendorLedger | null>(null);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    const [ag, reg] = await Promise.all([
      purchaseReportsApi.payablesAging(),
      purchaseReportsApi.purchaseRegister(from || undefined, to || undefined),
    ]);
    setAging(ag);
    setRegister(reg);
  }

  async function loadLedger(id = supplierId, from = range.from, to = range.to) {
    if (!id) { setLedger(null); return; }
    setLedger(await purchaseReportsApi.vendorLedger(id, from || undefined, to || undefined));
  }

  useEffect(() => {
    Promise.all([load(), crud('suppliers').list().then((s) => setSuppliers(s as Row[]))])
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  const aRows = aging?.rows ?? [];
  const at = aging?.totals;
  const rRows = register?.rows ?? [];
  const rt = register?.totals;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Purchase Reports</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Accounts payable — supplier outstanding aging, the purchase register, and a per-vendor ledger.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => { load().catch((e) => setError(String(e))); loadLedger().catch((e) => setError(String(e))); }}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); loadLedger(supplierId, '', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Register &amp; ledger bound by bill date. Aging is as-of-today. Leave blank for all-time.</span>
        </div>
      </Card>

      {/* ---- Payables aging (D1) ---- */}
      {at && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard label="Total payable" value={money(at.total)} tone="warning" />
          <StatCard label="0–30 days" value={money(at.b0_30)} />
          <StatCard label="31–60 days" value={money(at.b31_60)} />
          <StatCard label="61–90 days" value={money(at.b61_90)} />
          <StatCard label="90+ days" value={money(at.b90)} tone="danger" />
        </div>
      )}

      <Card
        title={`Payables aging${at ? ` — ${money(at.total)} outstanding` : ''}`}
        padded={false}
        actions={<ExportButton rows={aRows} columns={['supplierName', 'gstin', 'contactPerson', 'mobile', 'total', 'b0_30', 'b31_60', 'b61_90', 'b90']} filename="payables-aging" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : aRows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Contact</Th>
                  <Th numeric>0–30</Th>
                  <Th numeric>31–60</Th>
                  <Th numeric>61–90</Th>
                  <Th numeric>90+</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {aRows.map((r, i) => (
                  <tr key={i}>
                    <Td style={{ fontWeight: 600 }}>{String(r.supplierName ?? 'Unknown')}</Td>
                    <Td>{[r.contactPerson, r.mobile].filter(Boolean).map(String).join(' · ') || <span style={{ color: 'var(--mn-muted)' }}>—</span>}</Td>
                    <Td numeric>{money(r.b0_30)}</Td>
                    <Td numeric>{money(r.b31_60)}</Td>
                    <Td numeric>{money(r.b61_90)}</Td>
                    <Td numeric style={{ color: Number(r.b90) > 0 ? 'var(--mn-danger)' : undefined }}>{money(r.b90)}</Td>
                    <Td numeric style={{ fontWeight: 600 }}>{money(r.total)}</Td>
                  </tr>
                ))}
              </tbody>
              {at && (
                <tfoot>
                  <tr>
                    <Td style={{ fontWeight: 700 }}>All suppliers</Td>
                    <Td />
                    <Td numeric style={{ fontWeight: 700 }}>{money(at.b0_30)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(at.b31_60)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(at.b61_90)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(at.b90)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(at.total)}</Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : (
          <EmptyState title="Nothing outstanding" description="Approved vendor bills with a balance appear here, aged by bill date." />
        )}
      </Card>

      {/* ---- Purchase register (D3) ---- */}
      {rt && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard label="Taxable" value={money(rt.taxable)} />
          <StatCard label="Tax" value={money(rt.tax)} />
          <StatCard label="Total purchases" value={money(rt.total)} tone="info" />
          <StatCard label="Bills" value={String(rt.count ?? 0)} />
        </div>
      )}

      <Card
        title={`Purchase register${rt ? ` — ${String(rt.count)} bills` : ''}`}
        padded={false}
        actions={<ExportButton rows={rRows} columns={['billNo', 'supplierBillNo', 'billDate', 'supplierName', 'gstin', 'taxable', 'tax', 'total', 'matchStatus']} filename="purchase-register" />}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : rRows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Bill</Th>
                  <Th>Supplier bill</Th>
                  <Th>Date</Th>
                  <Th>Supplier</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>Tax</Th>
                  <Th numeric>Total</Th>
                  <Th>Match</Th>
                </tr>
              </thead>
              <tbody>
                {rRows.map((r, i) => (
                  <tr key={i}>
                    <Td style={{ fontWeight: 600 }}>{String(r.billNo)}</Td>
                    <Td>{String(r.supplierBillNo ?? '—')}</Td>
                    <Td>{String(r.billDate ?? '—')}</Td>
                    <Td>{String(r.supplierName ?? '')}</Td>
                    <Td numeric>{money(r.taxable)}</Td>
                    <Td numeric>{money(r.tax)}</Td>
                    <Td numeric style={{ fontWeight: 600 }}>{money(r.total)}</Td>
                    <Td>{String(r.matchStatus ?? '—')}</Td>
                  </tr>
                ))}
              </tbody>
              {rt && (
                <tfoot>
                  <tr>
                    <Td style={{ fontWeight: 700 }}>All bills</Td>
                    <Td /><Td /><Td />
                    <Td numeric style={{ fontWeight: 700 }}>{money(rt.taxable)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(rt.tax)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(rt.total)}</Td>
                    <Td />
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : (
          <EmptyState title="No purchases" description="Approved bills booked in the period appear here." />
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <Card
          title="By material"
          padded={false}
          actions={<ExportButton rows={register?.byMaterial ?? []} columns={['material', 'quantity', 'taxable', 'tax', 'total']} filename="purchase-by-material" />}
        >
          {register?.byMaterial?.length ? (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead><tr><Th>Material</Th><Th numeric>Qty</Th><Th numeric>Taxable</Th><Th numeric>Total</Th></tr></thead>
                <tbody>
                  {register.byMaterial.map((r, i) => (
                    <tr key={i}>
                      <Td>{String(r.material)}</Td>
                      <Td numeric>{qty(r.quantity)}</Td>
                      <Td numeric>{money(r.taxable)}</Td>
                      <Td numeric style={{ fontWeight: 600 }}>{money(r.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No material lines" description="Material-wise purchase totals appear here." />
          )}
        </Card>

        <Card
          title="By vendor"
          padded={false}
          actions={<ExportButton rows={register?.byVendor ?? []} columns={['supplierName', 'gstin', 'billCount', 'taxable', 'tax', 'total']} filename="purchase-by-vendor" />}
        >
          {register?.byVendor?.length ? (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead><tr><Th>Supplier</Th><Th numeric>Bills</Th><Th numeric>Taxable</Th><Th numeric>Total</Th></tr></thead>
                <tbody>
                  {register.byVendor.map((r, i) => (
                    <tr key={i}>
                      <Td>{String(r.supplierName ?? 'Unknown')}</Td>
                      <Td numeric>{String(r.billCount)}</Td>
                      <Td numeric>{money(r.taxable)}</Td>
                      <Td numeric style={{ fontWeight: 600 }}>{money(r.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No vendors" description="Vendor-wise purchase totals appear here." />
          )}
        </Card>
      </div>

      {/* ---- Vendor ledger (D2) ---- */}
      <Card title="Vendor ledger">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: ledger ? 16 : 0 }}>
          <div style={{ minWidth: 240 }}>
            <Field label="Supplier">
              <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); loadLedger(e.target.value).catch((err) => setError(String(err))); }}>
                <option value="">Select a supplier…</option>
                {suppliers.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.supplierName)}</option>)}
              </Select>
            </Field>
          </div>
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Bills as debits, payments as credits, with a running payable balance over the selected period.</span>
        </div>

        {ledger && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
              <StatCard label="Opening" value={money(ledger.opening)} />
              <StatCard label="Bills" value={money(ledger.totalDebit)} />
              <StatCard label="Payments" value={money(ledger.totalCredit)} />
              <StatCard label="Closing payable" value={money(ledger.closing)} tone="warning" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <ExportButton rows={ledger.rows} columns={['date', 'ref', 'particulars', 'debit', 'credit', 'balance']} filename={`vendor-ledger-${ledger.supplierName || 'supplier'}`} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr><Th>Date</Th><Th>Reference</Th><Th>Particulars</Th><Th numeric>Bill</Th><Th numeric>Payment</Th><Th numeric>Balance</Th></tr>
                </thead>
                <tbody>
                  <tr>
                    <Td /><Td /><Td style={{ fontStyle: 'italic', color: 'var(--mn-muted)' }}>Opening balance</Td>
                    <Td /><Td /><Td numeric style={{ fontWeight: 600 }}>{money(ledger.opening)}</Td>
                  </tr>
                  {ledger.rows.map((r, i) => (
                    <tr key={i}>
                      <Td>{String(r.date ?? '—')}</Td>
                      <Td>{String(r.ref ?? '')}</Td>
                      <Td>{String(r.particulars ?? '')}</Td>
                      <Td numeric>{Number(r.debit) ? money(r.debit) : ''}</Td>
                      <Td numeric>{Number(r.credit) ? money(r.credit) : ''}</Td>
                      <Td numeric>{money(r.balance)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <Td style={{ fontWeight: 700 }}>Closing</Td><Td /><Td />
                    <Td numeric style={{ fontWeight: 700 }}>{money(ledger.totalDebit)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(ledger.totalCredit)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(ledger.closing)}</Td>
                  </tr>
                </tfoot>
              </Table>
            </div>
            {!ledger.rows.length && <EmptyState title="No activity" description="This supplier has no bills or payments in the period." />}
          </div>
        )}
      </Card>
    </div>
  );
}
