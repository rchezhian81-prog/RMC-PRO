'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ordersApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, EmptyState } from '../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const FILTERS = ['', 'draft', 'confirmed', 'credit_hold', 'cancelled'];

export default function OrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await ordersApi.list(filter || undefined));
  }, [filter]);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Orders</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px', maxWidth: 720 }}>
        Confirm draft orders (credit-checked at booking). Over-limit bookings are blocked to a credit
        hold for approval.
      </p>
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
        {rows.length ? (
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
          <EmptyState title="No orders" description="Confirmed and draft orders will appear here." />
        )}
      </Card>
    </div>
  );
}
