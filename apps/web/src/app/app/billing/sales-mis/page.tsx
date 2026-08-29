'use client';

import { useEffect, useState } from 'react';
import { billingReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

function DimCard(props: {
  title: string;
  rows: Row[];
  nameKey: string;
  nameLabel: string;
  file: string;
  loaded: boolean;
  extraKey?: string;
  extraLabel?: string;
  showQty?: boolean;
  showInvoices?: boolean;
}) {
  const { title, rows, nameKey, nameLabel, file, loaded, extraKey, extraLabel, showQty, showInvoices } = props;
  const columns = [
    nameKey,
    ...(extraKey ? [extraKey] : []),
    ...(showInvoices ? ['invoices'] : []),
    ...(showQty ? ['quantity'] : []),
    'taxable',
    'total',
  ];
  return (
    <Card title={title} padded={false} actions={<ExportButton rows={rows} columns={columns} filename={file} />}>
      {!loaded ? (
        <TableSkeleton cols={4} />
      ) : rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <thead>
              <tr>
                <Th>{nameLabel}</Th>
                {extraKey ? <Th>{extraLabel}</Th> : null}
                {showInvoices ? <Th numeric>Invoices</Th> : null}
                {showQty ? <Th numeric>Qty m³</Th> : null}
                <Th numeric>Taxable</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <Td style={{ fontWeight: 600 }}>{String(r[nameKey] ?? '—')}</Td>
                  {extraKey ? <Td>{r[extraKey] ? String(r[extraKey]) : '—'}</Td> : null}
                  {showInvoices ? <Td numeric>{String(r.invoices)}</Td> : null}
                  {showQty ? <Td numeric>{qty(r.quantity)}</Td> : null}
                  <Td numeric>{money(r.taxable)}</Td>
                  <Td numeric style={{ fontWeight: 600 }}>{money(r.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No sales" description="Issued invoices in the period will summarise here." />
      )}
    </Card>
  );
}

export default function SalesMisPage() {
  const [data, setData] = useState<{ byCustomer: Row[]; byPlant: Row[]; byGrade: Row[]; totals: Row } | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    setData(await billingReportsApi.salesMis(from || undefined, to || undefined));
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const t = data?.totals;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Sales MIS</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Issued-invoice sales sliced by customer, plant and concrete grade — the management view behind the sales register.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Bounds by invoice date. Leave blank for all-time.</span>
        </div>
      </Card>

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Invoiced (total)" value={money(t.total)} tone="info" />
          <StatCard label="Taxable" value={money(t.taxable)} />
          <StatCard label="Invoices" value={String(t.invoices ?? 0)} />
        </div>
      )}

      <DimCard title="By customer" rows={data?.byCustomer ?? []} nameKey="customerName" nameLabel="Customer" file="sales-mis-by-customer" loaded={loaded} extraKey="customerType" extraLabel="Type" showInvoices />
      <DimCard title="By plant" rows={data?.byPlant ?? []} nameKey="plantName" nameLabel="Plant" file="sales-mis-by-plant" loaded={loaded} showInvoices />
      <DimCard title="By grade" rows={data?.byGrade ?? []} nameKey="grade" nameLabel="Grade" file="sales-mis-by-grade" loaded={loaded} showQty />
    </div>
  );
}
