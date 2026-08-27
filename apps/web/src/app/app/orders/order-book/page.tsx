'use client';

import { useEffect, useState } from 'react';
import { ordersApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const m3 = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function OrderBookPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    ordersApi.orderBook().then(setData).catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Order Book</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>Confirmed orders with ordered vs delivered vs balance m³ — what is still to pour.</p>
      </div>
      {error && <ErrorState message={error} />}

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Ordered m³" value={m3(t.ordered)} />
          <StatCard label="Delivered m³" value={m3(t.delivered)} />
          <StatCard label="Balance m³ (to pour)" value={m3(t.balance)} tone={Number(t.balance) > 0 ? 'warning' : 'neutral'} />
          <StatCard label="Confirmed orders" value={String(t.count)} />
        </div>
      )}

      <Card
        title="Order book"
        padded={false}
        actions={<ExportButton rows={rows} columns={['orderNo', 'orderDate', 'customerName', 'ordered', 'delivered', 'balance']} filename="order-book" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Date</Th>
                <Th>Customer</Th>
                <Th numeric>Ordered</Th>
                <Th numeric>Delivered</Th>
                <Th numeric>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <Td style={{ fontWeight: 600 }}>{String(r.orderNo)}</Td>
                  <Td>{String(r.orderDate ?? '—')}</Td>
                  <Td>{String(r.customerName ?? '')}</Td>
                  <Td numeric>{m3(r.ordered)}</Td>
                  <Td numeric>{m3(r.delivered)}</Td>
                  <Td numeric style={{ fontWeight: 600, color: Number(r.balance) > 0 ? 'var(--mn-warning)' : 'var(--mn-text)' }}>{m3(r.balance)}</Td>
                </tr>
              ))}
            </tbody>
            {t && (
              <tfoot>
                <tr>
                  <Td style={{ fontWeight: 700 }}>All orders</Td>
                  <Td /><Td />
                  <Td numeric style={{ fontWeight: 700 }}>{m3(t.ordered)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{m3(t.delivered)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{m3(t.balance)}</Td>
                </tr>
              </tfoot>
            )}
          </Table>
        ) : (
          <EmptyState title="No confirmed orders" description="Confirmed orders with a delivery balance will appear here." />
        )}
      </Card>
    </div>
  );
}
