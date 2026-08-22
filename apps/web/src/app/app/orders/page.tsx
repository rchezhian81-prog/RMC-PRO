'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ordersApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const FILTERS = ['', 'draft', 'confirmed', 'credit_hold', 'cancelled'];

export default function OrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    setLoaded(false);
    setRows(await ordersApi.list(filter || undefined));
    setLoaded(true);
  }, [filter]);

  useEffect(() => {
    reload().catch((e) => { setError(String(e)); setLoaded(true); });
  }, [reload]);

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Orders</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 12px', maxWidth: 720 }}>
        Confirm draft orders (credit-checked at booking). Over-limit bookings are blocked to a credit
        hold for approval.
      </p>
      <div
        style={{
          margin: '0 0 18px', padding: '10px 12px', maxWidth: 720,
          background: 'var(--mn-info-tint, var(--mn-surface-2))', borderRadius: 'var(--mn-radius-md)',
          border: '1px solid var(--mn-border)', fontSize: 13, color: 'var(--mn-muted)',
        }}
      >
        There is no “new order” button on purpose — an order is created from an{' '}
        <strong>approved quotation</strong> (or rate contract), so every order carries an agreed price.
        Start in{' '}
        <Link href="/app/sales/quotations" style={{ color: 'var(--mn-primary)', fontWeight: 600 }}>
          Sales → Quotations
        </Link>
        : create a quotation, add grade items, Submit, Approve, then “Convert → Order draft”. The draft
        then appears here to confirm.
      </div>
      {error && <div style={{ marginBottom: 16 }}><ErrorState message={error} /></div>}

      <Card
        title="Orders"
        actions={
          <select className="mn-input" style={{ width: 190 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === '' ? 'All statuses' : f.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Order No</Th>
                <Th>Source</Th>
                <Th>Order date</Th>
                <Th numeric>Est. value</Th>
                <Th>Credit</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.orderNo ?? '')}</Td>
                  <Td>{String(r.pricingSource ?? '—')}</Td>
                  <Td>{String(r.orderDate ?? '—')}</Td>
                  <Td numeric>{money(r.estimatedOrderValue)}</Td>
                  <Td>{String(r.creditStatus ?? '')}</Td>
                  <Td><StatusBadge status={String(r.orderStatus)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Link href={`/app/orders/${r.id}`}>
                      <Button variant="secondary" size="sm">Open</Button>
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="No orders yet"
            description="Orders appear here once you convert an approved quotation. Start in Sales → Quotations."
          />
        )}
      </Card>
    </div>
  );
}
