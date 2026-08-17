'use client';

import { useCallback, useEffect, useState } from 'react';
import { negativeStockApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const FILTERS = ['pending', '', 'approved', 'rejected'];

export default function NegativeStockPage() {
  const { prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    setRows(await negativeStockApi.list(filter || undefined));
  }, [filter]);
  useEffect(() => {
    reload().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, [reload]);

  async function decide(id: string, approve: boolean) {
    setError(null);
    setMsg(null);
    const remarks = await prompt({ title: approve ? 'Approve negative stock' : 'Reject negative stock', label: approve ? 'Approval remarks (optional)' : 'Rejection remarks', defaultValue: '' });
    if (remarks === null) return;
    try {
      if (approve) await negativeStockApi.approve(id, remarks);
      else await negativeStockApi.reject(id, remarks);
      setMsg(approve ? 'Approved — negative stock posted.' : 'Rejected.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Negative Stock Approvals</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px', maxWidth: 760 }}>
        Adjustments that would drive stock below zero. Approving posts the reduction (stock goes negative). Requires <code>negative_stock.approve</code>.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <Card
        title="Requests"
        actions={
          <select className="mn-input" style={{ width: 160 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>{f === '' ? 'All' : f}</option>
            ))}
          </select>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Available</Th>
                <Th numeric>Required</Th>
                <Th numeric>Negative</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = String(r.approvalStatus);
                return (
                  <tr key={r.id}>
                    <Td>{String(r.materialLabel ?? '—')}</Td>
                    <Td numeric>{money(r.availableQuantity)}</Td>
                    <Td numeric>{money(r.requiredQuantity)}</Td>
                    <Td numeric style={{ color: 'var(--mn-danger)', fontWeight: 600 }}>{money(r.negativeQuantity)}</Td>
                    <Td>{String(r.requestReason ?? '—')}</Td>
                    <Td><StatusBadge status={st} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      {st === 'pending' ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <Button size="sm" onClick={() => decide(String(r.id), true)}>Approve</Button>
                          <Button variant="secondary" size="sm" onClick={() => decide(String(r.id), false)}>Reject</Button>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>{String(r.approvalRemarks ?? '')}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No requests" description="Negative-stock approval requests will appear here." />
        )}
      </Card>
    </div>
  );
}
