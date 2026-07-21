'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { batchTicketsApi, type Row } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../../components/ui/States';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function BatchTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<Row | null>(null);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ticket = await batchTicketsApi.get(id);
    setT(ticket);
    const mats = (ticket.materials as Row[]) ?? [];
    setActuals(Object.fromEntries(mats.map((m) => [String(m.id), String(m.actualQuantity ?? '')])));
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await load();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function saveActuals() {
    const mats = (t?.materials as Row[]) ?? [];
    await run(
      () =>
        batchTicketsApi.updateActuals(
          id,
          mats.map((m) => ({ id: m.id, actualQuantity: Number(actuals[String(m.id)] || 0) })),
        ),
      'Actuals saved',
    );
  }

  async function confirm(override = false) {
    setError(null);
    setMsg(null);
    try {
      await batchTicketsApi.confirm(id, override);
      await load();
      setMsg('Batch confirmed — inventory reduced.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      if (/tolerance/i.test(message) && !override) {
        if (window.confirm(`${message}\n\nConfirm anyway with variance override?`)) return confirm(true);
        setError(message);
      } else {
        setError(message);
      }
    }
  }

  if (!t) return <Loading label="Loading batch ticket…" />;
  const mats = (t.materials as Row[]) ?? [];
  const status = String(t.status);
  const draft = status === 'draft';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/app/production/batch-tickets')}>
          Batch Tickets
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{String(t.batchTicketNo)}</h1>
        <StatusBadge status={status} />
        <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>
          {String(t.gradeLabel ?? '')} · {fmt(t.batchQuantityM3)} m³
        </span>
        {t.varianceExceeded ? <Badge tone="warning">variance override</Badge> : null}
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <div style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}

      <Card title="Material — target vs actual" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Material</Th>
              <Th numeric>Target</Th>
              <Th numeric>Actual</Th>
              <Th>UOM</Th>
              <Th numeric>Variance %</Th>
              <Th numeric>Tol %</Th>
              <Th>In tol?</Th>
            </tr>
          </thead>
          <tbody>
            {mats.map((m) => (
              <tr key={m.id}>
                <Td>{String(m.materialLabel ?? '')}</Td>
                <Td numeric>{fmt(m.targetQuantity)}</Td>
                <Td numeric>
                  {draft ? (
                    <Input
                      type="number"
                      step="any"
                      style={{ width: 110, textAlign: 'right' }}
                      value={actuals[String(m.id)] ?? ''}
                      onChange={(e) => setActuals({ ...actuals, [String(m.id)]: e.target.value })}
                    />
                  ) : (
                    fmt(m.actualQuantity)
                  )}
                </Td>
                <Td>{String(m.uom ?? '')}</Td>
                <Td numeric>{String(m.variancePercentage)}%</Td>
                <Td numeric>{String(m.tolerancePercentage)}%</Td>
                <Td>{m.withinTolerance ? <Badge tone="success">yes</Badge> : <Badge tone="warning">no</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {draft && (
          <div style={{ margin: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={saveActuals}>Save actuals</Button>
            <Button onClick={() => confirm(false)}>Confirm batch</Button>
            <Button variant="secondary" onClick={() => run(() => batchTicketsApi.cancel(id), 'Ticket cancelled')}>Cancel</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
