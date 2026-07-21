'use client';

import { useEffect, useState } from 'react';
import { billingReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function OutstandingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    billingReportsApi
      .outstanding()
      .then((d) => {
        setRows(d.rows as Row[]);
        setTotals(d.totals as Row);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Customer Outstanding</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>Outstanding on issued invoices, aged by invoice date.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      {totals && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          <StatCard label="0–30 days" value={money(totals.b0_30)} />
          <StatCard label="31–60 days" value={money(totals.b31_60)} />
          <StatCard label="61–90 days" value={money(totals.b61_90)} tone="warning" />
          <StatCard label="90+ days" value={money(totals.b90)} tone={Number(totals.b90) > 0 ? 'danger' : 'neutral'} />
          <StatCard label="Total outstanding" value={money(totals.total)} tone="info" />
        </div>
      )}

      <Card title="Ageing by customer" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th numeric>0–30</Th>
                <Th numeric>31–60</Th>
                <Th numeric>61–90</Th>
                <Th numeric>90+</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <Td>{String(r.customerName)}</Td>
                  <Td numeric>{money(r.b0_30)}</Td>
                  <Td numeric>{money(r.b31_60)}</Td>
                  <Td numeric>{money(r.b61_90)}</Td>
                  <Td numeric style={{ color: Number(r.b90) > 0 ? 'var(--mn-danger)' : 'var(--mn-text)' }}>{money(r.b90)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(r.total)}</Td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <Td style={{ fontWeight: 700 }}>All customers</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(totals.b0_30)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(totals.b31_60)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(totals.b61_90)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(totals.b90)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(totals.total)}</Td>
                </tr>
              </tfoot>
            )}
          </Table>
        ) : (
          <EmptyState title="No outstanding" description="Issued invoices with a balance will appear here." />
        )}
      </Card>
    </div>
  );
}
