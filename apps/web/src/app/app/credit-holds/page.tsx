'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { creditHoldsApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, EmptyState } from '../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const FILTERS = ['pending', '', 'approved', 'rejected'];

export default function CreditHoldsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await creditHoldsApi.list(filter || undefined));
  }, [filter]);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  async function decide(id: string, approve: boolean) {
    setError(null);
    setMsg(null);
    const note = window.prompt(approve ? 'Approval note (optional)' : 'Rejection reason', '');
    if (note === null) return;
    try {
      if (approve) await creditHoldsApi.approve(id, note);
      else await creditHoldsApi.reject(id, note);
      setMsg(approve ? 'Credit hold approved — order confirmed.' : 'Credit hold rejected.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Credit Holds</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px', maxWidth: 720 }}>
        Bookings blocked because they breach the customer credit limit. Approving confirms the order;
        rejecting leaves it on hold. Requires the <code>credit_hold.approve</code> permission.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <Card
        title="Credit holds"
        actions={
          <select className="mn-input" style={{ width: 180 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === '' ? 'All' : f}
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
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th numeric>Requested</Th>
                <Th numeric>Limit</Th>
                <Th numeric>Exposure</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = String(r.status);
                return (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/app/orders/${r.orderId}`} style={{ color: 'var(--mn-primary)', fontWeight: 600, textDecoration: 'none' }}>
                        {String(r.orderNo ?? '')}
                      </Link>
                    </Td>
                    <Td>{String(r.customerName ?? '—')}</Td>
                    <Td numeric>{money(r.requestedAmount)}</Td>
                    <Td numeric>{money(r.creditLimit)}</Td>
                    <Td numeric>{money(r.exposureAfter)}</Td>
                    <Td><StatusBadge status={st} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      {st === 'pending' ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <Button size="sm" onClick={() => decide(String(r.id), true)}>Approve</Button>
                          <Button variant="secondary" size="sm" onClick={() => decide(String(r.id), false)}>Reject</Button>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>{String(r.decisionNote ?? '')}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No credit holds" description="Over-limit bookings awaiting approval will appear here." />
        )}
      </Card>
    </div>
  );
}
