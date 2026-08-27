'use client';

import { useEffect, useState } from 'react';
import { purchaseApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function ItcRegisterPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    setData(await purchaseApi.itcRegister(from || undefined, to || undefined));
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Input Tax Credit (ITC) Register</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Approved vendor bills with the supplier GSTIN and the CGST/SGST vs IGST split — for claiming ITC and reconciling with GSTR-2B.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Bounds by bill date. Leave blank for all-time.</span>
        </div>
      </Card>

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard label="Taxable" value={money(t.taxable)} />
          <StatCard label="CGST" value={money(t.cgst)} />
          <StatCard label="SGST" value={money(t.sgst)} />
          <StatCard label="IGST" value={money(t.igst)} />
          <StatCard label="Total ITC" value={money(Number(t.cgst) + Number(t.sgst) + Number(t.igst))} tone="info" />
        </div>
      )}

      <Card
        title={`ITC register${t ? ` — ${String(t.count)} bills` : ''}`}
        padded={false}
        actions={<ExportButton rows={rows} columns={['billNo', 'supplierBillNo', 'billDate', 'supplierName', 'gstin', 'taxable', 'cgst', 'sgst', 'igst', 'total']} filename="itc-register" />}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Bill</Th>
                  <Th>Supplier bill</Th>
                  <Th>Date</Th>
                  <Th>Supplier</Th>
                  <Th>GSTIN</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>CGST</Th>
                  <Th numeric>SGST</Th>
                  <Th numeric>IGST</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <Td style={{ fontWeight: 600 }}>{String(r.billNo)}</Td>
                    <Td>{String(r.supplierBillNo ?? '—')}</Td>
                    <Td>{String(r.billDate ?? '—')}</Td>
                    <Td>{String(r.supplierName ?? '')}</Td>
                    <Td>{r.gstin ? String(r.gstin) : <span style={{ color: 'var(--mn-muted)' }}>—</span>}</Td>
                    <Td numeric>{money(r.taxable)}</Td>
                    <Td numeric>{money(r.cgst)}</Td>
                    <Td numeric>{money(r.sgst)}</Td>
                    <Td numeric>{money(r.igst)}</Td>
                    <Td numeric style={{ fontWeight: 600 }}>{money(r.total)}</Td>
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr>
                    <Td style={{ fontWeight: 700 }}>All bills</Td>
                    <Td /><Td /><Td /><Td />
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.taxable)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.cgst)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.sgst)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.igst)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.total)}</Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : (
          <EmptyState title="No approved bills" description="Approved vendor bills in the period will appear here." />
        )}
      </Card>
    </div>
  );
}
