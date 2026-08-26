'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { batchTicketsApi, batchingControllerApi, type Row } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const AGGREGATE_TYPES = ['fine_aggregate', 'coarse_aggregate'];
const isAggregate = (m: Row) => AGGREGATE_TYPES.includes(String(m.materialType));

export default function BatchTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm: askConfirm, prompt } = useConfirm();
  const [t, setT] = useState<Row | null>(null);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [moist, setMoist] = useState<Record<string, string>>({});
  const [controllers, setControllers] = useState<Row[]>([]);
  const [controllerId, setControllerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ticket, ctrls] = await Promise.all([
      batchTicketsApi.get(id),
      batchingControllerApi.list().catch(() => [] as Row[]),
    ]);
    setT(ticket);
    setControllers(ctrls);
    setControllerId((cur) => cur || (ctrls[0] ? String(ctrls[0].id) : ''));
    const mats = (ticket.materials as Row[]) ?? [];
    setActuals(Object.fromEntries(mats.map((m) => [String(m.id), String(m.actualQuantity ?? '')])));
    setMoist(Object.fromEntries(mats.map((m) => [String(m.id), m.measuredMoisturePct == null ? '' : String(m.measuredMoisturePct)])));
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
          mats.map((m) => {
            const mo = moist[String(m.id)];
            return {
              id: m.id,
              actualQuantity: Number(actuals[String(m.id)] || 0),
              ...(isAggregate(m) && mo !== '' && mo !== undefined ? { measuredMoisturePct: Number(mo) } : {}),
            };
          }),
        ),
      'Actuals saved',
    );
  }

  /** Push measured aggregate moisture only — the server recomputes corrected
   *  targets and mix water and re-seeds actuals to the corrected weight. */
  async function applyMoisture() {
    const mats = (t?.materials as Row[]) ?? [];
    await run(
      () =>
        batchTicketsApi.updateActuals(
          id,
          mats
            .filter(isAggregate)
            .map((m) => ({ id: m.id, measuredMoisturePct: Number(moist[String(m.id)] || 0) })),
        ),
      'Moisture applied — aggregate weights and mix water corrected.',
    );
  }

  // ---- A4: ingest actual batched weights from the plant controller ----
  function summarise(res: Awaited<ReturnType<typeof batchingControllerApi.ingest>>) {
    const r = res.reconciliation;
    const unmatched = r.unmatchedLog.length ? ` · ${r.unmatchedLog.length} controller line(s) unmatched` : '';
    return `Ingested ${r.matchedCount} material(s) from ${res.controllerName}${res.varianceExceeded ? ' — variance exceeds tolerance' : ' — all within tolerance'}${unmatched}`;
  }

  async function importFromController() {
    if (!controllerId) { setError('Add a batching controller first, then import.'); return; }
    await run(async () => {
      const res = await batchingControllerApi.ingest(controllerId, id);
      setMsg(summarise(res));
    });
  }

  async function pasteLog() {
    if (!controllerId) { setError('Add a batching controller first, then import.'); return; }
    const text = await prompt({ title: 'Paste controller batch log', label: 'Batch log (CSV: material, target, actual)', type: 'text' });
    if (!text) return;
    await run(async () => {
      const res = await batchingControllerApi.ingest(controllerId, id, text);
      setMsg(summarise(res));
    });
  }

  async function addController() {
    const name = await prompt({ title: 'Add batching controller', label: 'Controller name (simulated)', defaultValue: 'Plant controller', type: 'text' });
    if (!name) return;
    await run(async () => {
      const c = await batchingControllerApi.create({ name, connectionType: 'simulated' });
      setControllerId(String((c as Row)?.id ?? ''));
    }, 'Simulated controller added');
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
        if (await askConfirm({ title: 'Variance exceeds tolerance', message: `${message}\n\nConfirm anyway with variance override?`, confirmLabel: 'Override & confirm', danger: true })) {
          return confirm(true);
        }
        setError(message);
      } else {
        setError(message);
      }
    }
  }

  if (!t) return error ? <ErrorState message={error} /> : <Loading label="Loading batch ticket…" />;
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

      <Card title="Material — design → moisture-corrected → actual" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Material</Th>
              <Th numeric>Design (SSD)</Th>
              <Th numeric>Moisture %</Th>
              <Th numeric>Batch target</Th>
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
                  {draft && isAggregate(m) ? (
                    <Input
                      type="number"
                      step="any"
                      style={{ width: 80, textAlign: 'right' }}
                      value={moist[String(m.id)] ?? ''}
                      onChange={(e) => setMoist({ ...moist, [String(m.id)]: e.target.value })}
                    />
                  ) : m.measuredMoisturePct == null ? (
                    '—'
                  ) : (
                    `${fmt(m.measuredMoisturePct)}%`
                  )}
                </Td>
                <Td numeric>{fmt(m.correctedTargetQuantity ?? m.targetQuantity)}</Td>
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
        {(() => {
          const free = mats.filter(isAggregate).reduce((s, m) => s + Number(m.freeWaterQuantity ?? 0), 0);
          return free
            ? (
              <p style={{ margin: '12px 16px 0', fontSize: 12.5, color: 'var(--mn-muted)' }}>
                Aggregate free water: {fmt(free)} — mix water adjusted to hold the design water/cement ratio.
              </p>
            )
            : null;
        })()}
        {draft && (
          <div style={{ margin: '16px 16px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, color: 'var(--mn-muted)' }}>Batching controller:</span>
            <select className="mn-input" style={{ minWidth: 160 }} value={controllerId} onChange={(e) => setControllerId(e.target.value)}>
              {controllers.length === 0 && <option value="">— none —</option>}
              {controllers.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>{String(c.name)}{c.isActive === false ? ' (inactive)' : ''}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={importFromController}>Import from controller</Button>
            <Button variant="ghost" size="sm" onClick={pasteLog}>Paste log…</Button>
            <Button variant="ghost" size="sm" onClick={addController}>＋ Add controller</Button>
          </div>
        )}
        {draft && (
          <div style={{ margin: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {mats.some(isAggregate) && (
              <Button variant="secondary" onClick={applyMoisture}>Apply moisture</Button>
            )}
            <Button variant="secondary" onClick={saveActuals}>Save actuals</Button>
            <Button onClick={() => confirm(false)}>Confirm batch</Button>
            <Button variant="secondary" onClick={async () => { if (!(await askConfirm({ title: 'Cancel batch ticket', message: 'Cancel this batch ticket? This cannot be undone.', confirmLabel: 'Cancel ticket', danger: true }))) return; run(() => batchTicketsApi.cancel(id), 'Ticket cancelled'); }}>Cancel</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
