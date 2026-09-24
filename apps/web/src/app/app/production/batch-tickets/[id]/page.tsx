'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, ClipboardList, Clock3, Cpu, Droplets, FileCheck2, FlaskConical, Layers,
  RefreshCw, Save, Scale, Truck, User, XCircle,
} from 'lucide-react';
import { batchTicketsApi, batchingControllerApi, type Row } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { StatCard } from '../../../../../components/ui/StatCard';
import { Input, Select } from '../../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';
import { formatDateTime } from '../../../../../lib/format-date';

/**
 * Batch ticket — one batch from the queue to the stock it consumed.
 *
 * Board header with the facts (customer, order, grade and quantity, who ran
 * it, which plant) and the actions the stage allows; a note for a draft
 * waiting for its weights, weights off tolerance, a confirmation with an
 * override, a cancelled ticket, or QC that failed; five tiles; then two
 * columns: the materials weighed (editable while draft, with the controller
 * import and the moisture correction) and the batch record on the left; what
 * it was mixed for, the recipe and what happened to the concrete afterwards
 * on the right. Same layout in both skins; every colour reads the semantic
 * tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const pct = (v: unknown) => `${num(v) > 0 ? '+' : ''}${num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
const AGGREGATE_TYPES = ['fine_aggregate', 'coarse_aggregate'];
const isAggregate = (m: Row) => AGGREGATE_TYPES.includes(String(m.materialType));

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Minutes between two instants, when both exist. */
const minutesBetween = (a: unknown, b: unknown) =>
  a && b ? Math.max(0, Math.round((new Date(String(b)).getTime() - new Date(String(a)).getTime()) / 60_000)) : null;
const spanLabel = (mins: number) => {
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

/** How the batch was weighed, read off its materials. */
function weighing(mats: Row[], status: string): { label: string; note: string; tone: Tone; breaches: Row[]; weighed: number; worst: number } {
  const weighed = mats.filter((m) => num(m.actualQuantity) > 0).length;
  const breaches = mats.filter((m) => num(m.actualQuantity) > 0 && !m.withinTolerance);
  const worst = mats.reduce((w, m) => (num(m.actualQuantity) > 0 ? Math.max(w, Math.abs(num(m.variancePercentage))) : w), 0);
  const worstLabel = `worst ±${worst.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  if (status === 'cancelled') return { label: 'Not weighed', note: 'Cancelled', tone: 'neutral', breaches, weighed, worst };
  if (!mats.length) return { label: 'No materials', note: 'No mix design on this ticket', tone: 'neutral', breaches, weighed, worst };
  if (!weighed) return { label: 'No actuals yet', note: `${mats.length} to weigh`, tone: status === 'draft' ? 'warning' : 'neutral', breaches, weighed, worst };
  if (breaches.length) return { label: `${breaches.length} of ${mats.length} off tolerance`, note: worstLabel, tone: 'danger', breaches, weighed, worst };
  return { label: 'Within tolerance', note: `${weighed} of ${mats.length} weighed · ${worstLabel}`, tone: 'success', breaches, weighed, worst };
}

export default function BatchTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { confirm: askConfirm, prompt } = useConfirm();
  const [t, setT] = useState<Row | null>(null);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [moist, setMoist] = useState<Record<string, string>>({});
  const [controllers, setControllers] = useState<Row[]>([]);
  const [controllerId, setControllerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ticket, ctrls] = await Promise.all([
      batchTicketsApi.get(id),
      batchingControllerApi.list().catch(() => [] as Row[]),
    ]);
    setT(ticket);
    setControllers(ctrls);
    setControllerId((cur) => cur || (ctrls[0] ? String(ctrls[0].id) : ''));
    const mats = (ticket.materials as Row[]) ?? [];
    // The API pads to three decimals ("3600.000"); the inputs show the plain number.
    const plain = (v: unknown) => (v == null || v === '' ? '' : String(Number(v)));
    setActuals(Object.fromEntries(mats.map((m) => [String(m.id), plain(m.actualQuantity)])));
    setMoist(Object.fromEntries(mats.map((m) => [String(m.id), plain(m.measuredMoisturePct)])));
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const out = await fn();
      await load();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  function actualRows(mats: Row[]) {
    return mats.map((m) => {
      const mo = moist[String(m.id)];
      return {
        id: m.id,
        actualQuantity: Number(actuals[String(m.id)] || 0),
        ...(isAggregate(m) && mo !== '' && mo !== undefined ? { measuredMoisturePct: Number(mo) } : {}),
      };
    });
  }

  async function saveActuals() {
    const mats = (t?.materials as Row[]) ?? [];
    await run(() => batchTicketsApi.updateActuals(id, actualRows(mats)), 'Weights saved; variance rechecked.');
  }

  /** Push measured aggregate moisture only: the server recomputes corrected
   *  targets and mix water and re-seeds actuals to the corrected weight. */
  async function applyMoisture() {
    const mats = (t?.materials as Row[]) ?? [];
    await run(
      () =>
        batchTicketsApi.updateActuals(
          id,
          mats.filter(isAggregate).map((m) => ({ id: m.id, measuredMoisturePct: Number(moist[String(m.id)] || 0) })),
        ),
      'Moisture applied: aggregate weights and mix water corrected.',
    );
  }

  // ---- actual batched weights from the plant controller ----
  function summarise(res: Awaited<ReturnType<typeof batchingControllerApi.ingest>>) {
    const r = res.reconciliation;
    const unmatched = r.unmatchedLog.length ? ` · ${r.unmatchedLog.length} controller line(s) did not match a material` : '';
    return `Imported ${r.matchedCount} material(s) from ${res.controllerName}${res.varianceExceeded ? '; variance exceeds tolerance' : '; all within tolerance'}${unmatched}.`;
  }

  async function importFromController() {
    if (!controllerId) { setError('Add a batching controller first, then import.'); return; }
    await run(async () => summarise(await batchingControllerApi.ingest(controllerId, id)));
  }

  async function pasteLog() {
    if (!controllerId) { setError('Add a batching controller first, then import.'); return; }
    const text = await prompt({ title: 'Paste controller batch log', label: 'Batch log (CSV: material, target, actual)', type: 'text' });
    if (!text) return;
    await run(async () => summarise(await batchingControllerApi.ingest(controllerId, id, text)));
  }

  async function addController() {
    const name = await prompt({ title: 'Add batching controller', label: 'Controller name (simulated)', defaultValue: 'Plant controller', type: 'text' });
    if (!name) return;
    await run(async () => {
      const c = await batchingControllerApi.create({ name, connectionType: 'simulated' });
      setControllerId(String((c as Row)?.id ?? ''));
    }, 'Simulated controller added.');
  }

  /**
   * Confirm the batch. The API refuses a tolerance breach and a stock
   * shortfall until the operator overrides each one knowingly; both come back
   * as plain errors, so the question is asked here and the call repeated.
   */
  async function confirm(overrideVariance = false, allowNegativeStock = false) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await batchTicketsApi.confirm(id, overrideVariance, allowNegativeStock);
      await load();
      setMsg('Batch confirmed; the materials used were deducted from stock.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      if (/tolerance/i.test(message) && !overrideVariance) {
        setBusy(false);
        if (await askConfirm({ title: 'Weights off tolerance', message: `${message}\n\nConfirm anyway? The ticket is marked as confirmed with a variance override.`, confirmLabel: 'Override and confirm', danger: true })) {
          return confirm(true, allowNegativeStock);
        }
        setError(message);
        return;
      }
      if (/insufficient stock/i.test(message) && !allowNegativeStock) {
        setBusy(false);
        if (await askConfirm({ title: 'Not enough stock booked', message: `${message}\n\nConfirm anyway and let the stock go negative? Do this only when the material is physically in the plant and its inward is still to be entered.`, confirmLabel: 'Allow negative stock', danger: true })) {
          return confirm(overrideVariance, true);
        }
        setError(message);
        return;
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (!t) return error ? <ErrorState message={error} /> : <Loading label="Loading batch ticket…" />;
  const mats = (t.materials as Row[]) ?? [];
  const status = String(t.status);
  const draft = status === 'draft';
  const w = weighing(mats, status);
  const dispatches = (t.dispatches as Row[]) ?? [];
  const challans = (t.challans as Row[]) ?? [];
  const dispatchedM3 = dispatches.filter((d) => String(d.dispatchStatus) !== 'cancelled').reduce((s, d) => s + num(d.quantityM3), 0);
  const duration = minutesBetween(t.batchStartTime, t.batchEndTime);
  const freeWater = mats.filter(isAggregate).reduce((s, m) => s + num(m.freeWaterQuantity), 0);
  const hasStockAfter = status === 'confirmed' && mats.some((m) => m.balanceAfter != null);
  // Moisture and the dry design weight only earn a column when they change
  // something: an aggregate to measure while draft, or a correction on record.
  const showMoisture = draft ? mats.some(isAggregate) : mats.some((m) => m.measuredMoisturePct != null);
  const showDesign = mats.some((m) => m.correctedTargetQuantity != null && Math.abs(num(m.correctedTargetQuantity) - num(m.targetQuantity)) > 0.0005);
  const colCount = 6 + (showMoisture ? 1 : 0) + (showDesign ? 1 : 0) + (hasStockAfter ? 1 : 0);
  const qcFailed = num(t.slumpFailed) + num(t.cubesRejected);
  const fromController = String(t.sourceType) === 'controller' || !!t.controllerName;
  const planned = num(t.queuePlannedM3);
  const produced = num(t.queueProducedM3);
  const stockTile: { label: string; tone: Tone } =
    status === 'confirmed' ? { label: 'Deducted', tone: 'success' } : status === 'cancelled' ? { label: 'Untouched', tone: 'neutral' } : { label: 'Not yet', tone: 'neutral' };

  const breachList = w.breaches.map((m) => `${String(m.materialLabel ?? 'material')} ${pct(m.variancePercentage)} (±${qty(m.tolerancePercentage)}% allowed)`).join(', ');

  return (
    <div className="mn-od mn-btd">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/app/production/batch-tickets" className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Batch tickets</Link>
          <h1>
            {String(t.batchTicketNo ?? '')}
            <span className="mn-od-badges">
              <StatusBadge status={status} />
              {t.varianceExceeded ? <Badge tone="warning">Variance override</Badge> : null}
              {fromController ? <Badge tone="info">From controller</Badge> : null}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who"><Building2 size={14} aria-hidden /> {String(t.customerName ?? 'No customer')}</span>
            {t.orderId ? <span className="mn-od-fact"><ClipboardList size={14} aria-hidden /> <Link href={`/app/orders/${String(t.orderId)}`} className="mn-id-link">{String(t.orderNo ?? 'Order')}</Link></span> : null}
            <span className="mn-od-fact"><Layers size={14} aria-hidden /> {String(t.gradeLabel ?? 'No grade')} · {qty(t.batchQuantityM3)} m³</span>
            {t.operatorName ? <span className="mn-od-fact"><User size={14} aria-hidden /> Batched by {String(t.operatorName)}</span> : null}
            {t.plantName ? <span className="mn-od-fact"><Cpu size={14} aria-hidden /> {String(t.plantName)}</span> : null}
          </p>
        </div>
        <div className="mn-board-tools">
          {draft && (
            <Button icon={<CheckCircle2 size={14} />} loading={busy} onClick={() => confirm()}>Confirm batch</Button>
          )}
          {draft && (
            <Button
              variant="ghost"
              icon={<XCircle size={14} />}
              onClick={async () => {
                if (!(await askConfirm({ title: 'Cancel batch ticket', message: 'Cancel this ticket? Nothing was deducted from stock; the queue line goes back to waiting if nothing else was batched on it. This cannot be undone.', confirmLabel: 'Cancel ticket', danger: true }))) return;
                run(() => batchTicketsApi.cancel(id), 'Ticket cancelled.');
              }}
            >
              Cancel
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => run(async () => undefined)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><FileCheck2 size={16} aria-hidden /><span>{msg}</span></div>}

      {draft && !w.weighed && (
        <div className="mn-ord-note" role="status">
          <Scale size={16} aria-hidden />
          <span><strong>Not confirmed yet.</strong> Enter the weights actually batched, or import them from the plant controller, then press Confirm batch. Stock is untouched until then.</span>
        </div>
      )}
      {draft && w.weighed > 0 && w.breaches.length > 0 && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <AlertTriangle size={16} aria-hidden />
          <span><strong>{w.breaches.length} of {mats.length} materials off tolerance:</strong> {breachList}. Fix a mis-keyed weight and save again; confirming as it stands asks for an override and marks the ticket.</span>
        </div>
      )}
      {draft && w.weighed > 0 && w.breaches.length === 0 && (
        <div className="mn-ord-note" role="status">
          <CheckCircle2 size={16} aria-hidden />
          <span><strong>Ready to confirm.</strong> {w.weighed} of {mats.length} materials weighed, all within tolerance. Confirming deducts them from stock and locks the ticket.</span>
        </div>
      )}
      {status === 'confirmed' && !!t.varianceExceeded && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <AlertTriangle size={16} aria-hidden />
          <span><strong>Confirmed with a variance override{t.batchEndTime ? ` on ${formatDateTime(t.batchEndTime)}` : ''}.</strong> {breachList ? `Off tolerance: ${breachList}. ` : ''}The concrete went out on the weights below; check the cubes cast from it.</span>
        </div>
      )}
      {status === 'cancelled' && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <XCircle size={16} aria-hidden />
          <span><strong>Cancelled.</strong> Nothing was deducted from stock. If the load is still wanted, start a fresh batch from the <Link href="/app/production/batch-queue">Batch queue</Link>.</span>
        </div>
      )}
      {qcFailed > 0 && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <FlaskConical size={16} aria-hidden />
          <span>
            <strong>QC failed on this batch.</strong>{' '}
            {num(t.slumpFailed) > 0 ? `${String(t.slumpFailed)} slump ${num(t.slumpFailed) === 1 ? 'test' : 'tests'} failed. ` : ''}
            {num(t.cubesRejected) > 0 ? `${String(t.cubesRejected)} cube ${num(t.cubesRejected) === 1 ? 'set' : 'sets'} rejected at 28 days. ` : ''}
            See <Link href="/app/qc/register">QC → Register</Link>.
          </span>
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Quantity" value={`${qty(t.batchQuantityM3)} m³`} />
        <StatCard label="Grade" value={String(t.gradeLabel ?? '—')} />
        <StatCard label="Weighing" value={w.label} tone={w.tone} />
        <StatCard label="Dispatched" value={dispatches.length ? `${qty(dispatchedM3)} m³` : status === 'confirmed' ? 'Not yet' : '—'} tone={dispatches.length ? 'info' : 'neutral'} />
        <StatCard label="Stock" value={stockTile.label} tone={stockTile.tone} />
      </div>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><Scale size={16} aria-hidden /> Materials weighed</span>} padded={false}>
            <div className="mn-id-scroll">
              <Table>
                <thead>
                  <tr>
                    <Th>Material</Th>
                    {showDesign ? <Th numeric>Design (SSD)</Th> : null}
                    {showMoisture ? <Th numeric>Moisture</Th> : null}
                    <Th numeric>{showDesign ? 'Target (wet)' : 'Target'}</Th>
                    <Th numeric>Actual</Th>
                    <Th numeric>Variance</Th>
                    <Th numeric>Allowed</Th>
                    <Th>Result</Th>
                    {hasStockAfter ? <Th numeric>Stock after</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {mats.map((m) => {
                    const weighed = num(m.actualQuantity) > 0;
                    const target = num(m.correctedTargetQuantity ?? m.targetQuantity);
                    return (
                      <tr key={String(m.id)} className={weighed && !m.withinTolerance ? 'mn-btd-breach' : undefined}>
                        <Td>
                          <span className="mn-od-num">{String(m.materialLabel ?? '')}</span>
                          <span className="mn-od-rate-meta">{String(m.uom ?? '')}{isAggregate(m) ? ' · aggregate' : ''}</span>
                        </Td>
                        {showDesign ? <Td numeric>{qty(m.targetQuantity)}</Td> : null}
                        {showMoisture ? <Td numeric>
                          {draft && isAggregate(m) ? (
                            <Input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              className="mn-btd-in mn-btd-in--sm"
                              aria-label={`Moisture % for ${String(m.materialLabel ?? 'material')}`}
                              value={moist[String(m.id)] ?? ''}
                              onChange={(e) => setMoist({ ...moist, [String(m.id)]: e.target.value })}
                            />
                          ) : m.measuredMoisturePct == null ? '—' : `${qty(m.measuredMoisturePct)}%`}
                        </Td> : null}
                        <Td numeric>{qty(target)}</Td>
                        <Td numeric>
                          {draft ? (
                            <Input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              className="mn-btd-in"
                              aria-label={`Actual for ${String(m.materialLabel ?? 'material')}`}
                              value={actuals[String(m.id)] ?? ''}
                              onChange={(e) => setActuals({ ...actuals, [String(m.id)]: e.target.value })}
                            />
                          ) : (
                            <span className="mn-od-num">{qty(m.actualQuantity)}</span>
                          )}
                        </Td>
                        <Td numeric>
                          {weighed ? (
                            <>
                              <span className={`mn-od-num${!m.withinTolerance ? ' mn-id-bad' : ''}`}>{pct(m.variancePercentage)}</span>
                              <span className="mn-od-rate-meta">{num(m.varianceQuantity) > 0 ? '+' : ''}{qty(m.varianceQuantity)} {String(m.uom ?? '')}</span>
                            </>
                          ) : '—'}
                        </Td>
                        <Td numeric>±{qty(m.tolerancePercentage)}%</Td>
                        <Td>
                          {!weighed ? <Badge tone="neutral">Not weighed</Badge> : m.withinTolerance ? <Badge tone="success">Within</Badge> : <Badge tone="danger">Off tolerance</Badge>}
                        </Td>
                        {hasStockAfter ? <Td numeric>{m.balanceAfter == null ? '—' : <span className={num(m.balanceAfter) < 0 ? 'mn-id-bad' : undefined}>{qty(m.balanceAfter)}</span>}</Td> : null}
                      </tr>
                    );
                  })}
                  {!mats.length && (
                    <tr><Td colSpan={colCount}>No materials on this ticket: the mix design had no lines when it was started.</Td></tr>
                  )}
                </tbody>
              </Table>
            </div>
            {freeWater > 0 && (
              <p className="mn-btd-hint">
                <Droplets size={14} aria-hidden /> Aggregate free water {qty(freeWater)} {String(mats.find(isAggregate)?.uom ?? '')}: the mix water was reduced to hold the design water-cement ratio.
              </p>
            )}
            {draft && (
              <div className="mn-btd-ctl">
                <span className="mn-ord-meta"><Cpu size={14} aria-hidden /> Plant controller</span>
                <Select className="mn-btd-ctl-pick" value={controllerId} onChange={(e) => setControllerId(e.target.value)} aria-label="Batching controller">
                  {controllers.length === 0 && <option value="">None added</option>}
                  {controllers.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>{String(c.name)}{c.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </Select>
                <Button variant="secondary" size="sm" onClick={importFromController} disabled={busy}>Import weights</Button>
                <Button variant="ghost" size="sm" onClick={pasteLog} disabled={busy}>Paste log…</Button>
                <Button variant="ghost" size="sm" onClick={addController} disabled={busy}>Add controller</Button>
              </div>
            )}
            {draft && (
              <div className="mn-od-lines-foot">
                <span className="mn-ord-meta">{w.weighed ? `${w.weighed} of ${mats.length} weighed · ${w.note}` : `${mats.length} materials to weigh`}</span>
                <div className="mn-btd-acts">
                  {mats.some(isAggregate) && <Button variant="secondary" icon={<Droplets size={14} />} onClick={applyMoisture} disabled={busy}>Apply moisture</Button>}
                  <Button variant="secondary" icon={<Save size={14} />} onClick={saveActuals} disabled={busy}>Save weights</Button>
                  <Button icon={<CheckCircle2 size={14} />} onClick={() => confirm()} loading={busy}>Confirm batch</Button>
                </div>
              </div>
            )}
          </Card>

          <Card title={<span className="mn-board-card-title"><Clock3 size={16} aria-hidden /> Batch record</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Started</dt><dd>{t.batchStartTime ? formatDateTime(t.batchStartTime) : '—'}</dd></div>
              <div><dt>{status === 'confirmed' ? 'Confirmed' : 'Finished'}</dt><dd>{t.batchEndTime ? formatDateTime(t.batchEndTime) : status === 'draft' ? 'Not yet' : '—'}</dd></div>
              {duration != null && <div><dt>Took</dt><dd>{spanLabel(duration)}</dd></div>}
              <div><dt>Operator</dt><dd>{String(t.operatorName ?? '—')}</dd></div>
              <div><dt>Plant</dt><dd className="mn-id-wrap">{String(t.plantName ?? '—')}</dd></div>
              <div><dt>Weights from</dt><dd>{fromController ? `Controller${t.controllerName ? ` · ${String(t.controllerName)}` : ''}` : 'Keyed by hand'}</dd></div>
              {t.controllerBatchRef ? <div><dt>Controller ref</dt><dd>{String(t.controllerBatchRef)}</dd></div> : null}
              {t.ingestedAt ? <div><dt>Imported at</dt><dd>{formatDateTime(t.ingestedAt)}</dd></div> : null}
              {t.notes ? <div><dt>Notes</dt><dd className="mn-id-wrap">{String(t.notes)}</dd></div> : null}
            </dl>
          </Card>
        </div>

        <aside className="mn-od-side">
          <Card title="Mixed for">
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Order</dt><dd>{t.orderId ? <Link href={`/app/orders/${String(t.orderId)}`} className="mn-id-link">{String(t.orderNo ?? 'Order')}</Link> : 'No order'}</dd></div>
              <div><dt>Customer</dt><dd className="mn-id-wrap">{String(t.customerName ?? '—')}</dd></div>
              <div><dt>Site</dt><dd className="mn-id-wrap">{String(t.siteName ?? '—')}</dd></div>
              {t.batchQueueId ? (
                <div><dt>Queue line</dt><dd>{qty(produced)} of {qty(planned)} m³{t.queueStatus ? <span className="mn-ord-meta"> · {String(t.queueStatus)}</span> : null}</dd></div>
              ) : null}
            </dl>
            {t.batchQueueId && planned > 0 ? (
              <span className="mn-od-linebar mn-btd-bar" aria-hidden><span style={{ width: `${Math.min(100, Math.round((produced / planned) * 100))}%` }} /></span>
            ) : null}
            {t.batchQueueId ? (
              <p className="mn-board-form-hint">
                {planned > produced + 0.001 ? `${qty(planned - produced)} m³ still to batch on this line; start the next load from the Batch queue.` : 'This line is fully batched.'}
              </p>
            ) : null}
          </Card>

          <Card title={<span className="mn-board-card-title"><FlaskConical size={16} aria-hidden /> Recipe</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Mix design</dt><dd>{t.mixDesignId ? <Link href="/app/production/mix-designs" className="mn-id-link">{String(t.mixCode ?? 'Mix')}{t.mixVersion ? ` v${String(t.mixVersion)}` : ''}</Link> : '—'}</dd></div>
              <div><dt>Grade</dt><dd>{String(t.gradeLabel ?? '—')}</dd></div>
              {t.waterCementRatio ? <div><dt>Water / cement</dt><dd>{qty(t.waterCementRatio)}</dd></div> : null}
              {t.slumpMin != null || t.slumpMax != null ? <div><dt>Slump</dt><dd>{t.slumpMin != null ? String(t.slumpMin) : '?'}–{t.slumpMax != null ? String(t.slumpMax) : '?'} mm</dd></div> : null}
              {t.cementType ? <div><dt>Cement</dt><dd>{String(t.cementType)}</dd></div> : null}
              {t.pumpable != null ? <div><dt>Pumpable</dt><dd>{t.pumpable ? 'Yes' : 'No'}</dd></div> : null}
            </dl>
            <p className="mn-board-form-hint">Targets are the approved design scaled to {qty(t.batchQuantityM3)} m³, then corrected for the moisture in the aggregates.</p>
          </Card>

          <Card title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> After batching</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              {dispatches.map((d) => (
                <div key={String(d.id)}>
                  <dt>Dispatch</dt>
                  <dd><Link href="/app/dispatch/board" className="mn-id-link">{String(d.dispatchNo)}</Link><span className="mn-ord-meta"> · {String(d.dispatchStatus).replace(/_/g, ' ')}{d.vehicleNo ? ` · ${String(d.vehicleNo)}` : ''}</span></dd>
                </div>
              ))}
              {challans.map((c) => (
                <div key={String(c.id)}>
                  <dt>Challan</dt>
                  <dd><Link href={`/app/dispatch/challans/${String(c.id)}`} className="mn-id-link">{String(c.challanNo)}</Link><span className="mn-ord-meta"> · {String(c.challanStatus)}</span></dd>
                </div>
              ))}
              <div><dt>Slump tests</dt><dd>{num(t.slumpTests) ? <Link href="/app/qc/slump" className="mn-id-link">{String(t.slumpTests)}{num(t.slumpFailed) ? <span className="mn-id-bad"> · {String(t.slumpFailed)} failed</span> : null}</Link> : 'None'}</dd></div>
              <div><dt>Cube sets</dt><dd>{num(t.cubeSets) ? <Link href="/app/qc/cubes" className="mn-id-link">{String(t.cubeSets)}{num(t.cubesRejected) ? <span className="mn-id-bad"> · {String(t.cubesRejected)} rejected</span> : null}</Link> : 'None'}</dd></div>
            </dl>
            <p className="mn-board-form-hint">
              {status === 'confirmed' && !dispatches.length
                ? 'Not dispatched yet: send the load from the Dispatch board once the truck is at the plant.'
                : status === 'draft'
                  ? 'The load can be dispatched once the batch is confirmed.'
                  : status === 'cancelled'
                    ? 'Nothing left the plant on this ticket.'
                    : 'Every dispatch and challan that carried this concrete, and the QC taken from it.'}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
