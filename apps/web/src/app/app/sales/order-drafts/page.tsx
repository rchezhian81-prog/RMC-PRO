'use client';

import { useEffect, useState } from 'react';
import { orderDraftsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function OrderDraftsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    orderDraftsApi
      .list()
      .then(setRows)
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function open(id: string) {
    setError(null);
    setSel(await orderDraftsApi.get(id));
  }

  const items = (sel?.items as Row[]) ?? [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Order Drafts</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0, maxWidth: 780 }}>
          Draft orders created from approved quotations / rate contracts — the sales → operations handoff.
          Confirmation and credit check happen in Orders.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Order drafts" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={8} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Order No</Th>
                <Th>Customer</Th>
                <Th>Source</Th>
                <Th>Order date</Th>
                <Th>Credit</Th>
                <Th>Status</Th>
                <Th numeric>Est. value</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.orderNo ?? '')}</Td>
                  <Td>{String(r.customerName ?? '—')}</Td>
                  <Td>{String(r.pricingSource ?? '—')}</Td>
                  <Td>{String(r.orderDate ?? '—')}</Td>
                  <Td>{String(r.creditStatus ?? '')}</Td>
                  <Td><StatusBadge status={String(r.orderStatus)} /></Td>
                  <Td numeric>{money(r.estimatedOrderValue)}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => open(String(r.id))}>Lines</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No order drafts yet" description="Convert an approved quotation to create one." />
        )}
      </Card>

      {sel && (
        <Card title={`${String(sel.orderNo)} — lines`} padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Grade</Th>
                <Th numeric>Qty m³</Th>
                <Th numeric>Rate/m³</Th>
                <Th numeric>Transport</Th>
                <Th numeric>Pump</Th>
                <Th numeric>Waiting</Th>
                <Th>Line status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <Td>{String(it.gradeLabel ?? '')}</Td>
                  <Td numeric>{Number(it.quantityM3 ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Td>
                  <Td numeric>{Number(it.ratePerM3 ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Td>
                  <Td numeric>{Number(it.transportCharge ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Td>
                  <Td numeric>{Number(it.pumpCharge ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Td>
                  <Td numeric>{Number(it.waitingCharge ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Td>
                  <Td>{String(it.lineStatus ?? '')}</Td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <Td colSpan={7} style={{ color: 'var(--mn-muted)' }}>No lines.</Td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
