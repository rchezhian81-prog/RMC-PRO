'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, ClipboardList, ListOrdered, Plus, RefreshCw, Send, Trash2, X, XCircle } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../../lib/format-date';
import { todayLocal } from '../../../../lib/report-range';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, ordersApi, productionPlansApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Production plans — the shift's worksheet.
 *
 * A status strip (draft / confirmed / batching / completed / cancelled) with
 * live counts doubles as the filter, a summary pill totals the concrete
 * planned on screen, and each plan is one tappable row: number with date
 * and shift, plant with the customers on it, lines and m³ with how many have
 * reached the queue, status. Notes flag drafts not yet confirmed and
 * confirmed plans whose lines are not yet queued. The "new plan" form sits
 * above the list; the open plan's worksheet sits below it with its lines
 * (order, site and pour time, grade, planned against ordered, where the
 * queue has taken it), an add-line form that resolves the order's lines, and
 * the actions the state allows. Same layout in both skins; every colour
 * reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'neutral', hint: 'Being written: lines can still be added and removed' },
  { key: 'confirmed', label: 'Confirmed', tone: 'warning', hint: 'Agreed for the shift; send its lines to the batch queue' },
  { key: 'in_progress', label: 'Batching', tone: 'info', hint: 'Its lines are on the batch queue; the plant is working through them' },
  { key: 'completed', label: 'Completed', tone: 'success', hint: 'Every line batched; a record of the shift' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Abandoned; nothing on it will be batched' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;
const TERMINAL = ['completed', 'cancelled'];
const shiftLabel = (s: unknown) => (String(s ?? '') === 'night' ? 'Night shift' : String(s ?? '') === 'day' ? 'Day shift' : s ? String(s) : 'No shift');

/** "Mon 22 Sep 2026" from a bare YYYY-MM-DD, without a timezone shift. */
function dayLabel(date: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return formatDate(date);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Where a plan line stands, as the Queue column reads it. */
function queueCell(it: Row): { label: string; tone: Tone; note: string } {
  const q = String(it.queueStatus ?? '');
  if (!q) return String(it.status) === 'queued' ? { label: 'Queued', tone: 'info', note: 'Already on the queue from the order' } : { label: 'Not sent', tone: 'neutral', note: 'Send the plan to the batch queue' };
  const produced = num(it.producedM3);
  const note = produced > 0 ? `${qty(produced)} of ${qty(it.plannedQuantityM3)} m³ batched` : 'Nothing batched yet';
  if (q === 'waiting') return { label: 'Waiting', tone: 'info', note };
  if (q === 'batching') return { label: 'Batching', tone: 'info', note };
  if (q === 'held') return { label: 'Held', tone: 'warning', note };
  if (q === 'completed') return { label: 'Batched', tone: 'success', note };
  if (q === 'cancelled') return { label: 'Queue cancelled', tone: 'danger', note: 'Its queue line was cancelled' };
  return { label: q.replace(/_/g, ' '), tone: 'neutral', note };
}

export default function ProductionPlansPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ plantId: '', planDate: todayLocal(), shift: 'day' });
  const [item, setItem] = useState({ orderId: '', orderItemId: '', plannedQuantityM3: '' });
  const [orderLines, setOrderLines] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [p, pl, o] = await Promise.all([productionPlansApi.list(win.limit), crud('plants').list(), ordersApi.list('confirmed')]);
    setRows(p);
    setPlants(pl);
    setOrders(o);
    // One plant is the common case: pick it so the form is two fields.
    setForm((f) => (f.plantId || pl.length !== 1 ? f : { ...f, plantId: String(pl[0]?.id ?? '') }));
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  // Arriving with ?plan=<id> (a link from the queue or a message) opens that
  // plan's worksheet straight away.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('plan');
    if (id) productionPlansApi.get(id).then(setSel).catch((e) => setError(String(e)));
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      if (sel) setSel(await productionPlansApi.get(String(sel.id)));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  /** Run an action, then refresh the list and the open plan; errors surface inline. */
  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const out = await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const created = await productionPlansApi.create({ plantId: form.plantId || undefined, planDate: form.planDate || undefined, shift: form.shift });
      setSel(await productionPlansApi.get(String(created.id)));
      return `${String((created as Row).planNo ?? 'Plan')} created; add the orders to batch below.`;
    });
  }

  async function open(id: string) {
    setMsg(null);
    setError(null);
    setItem({ orderId: '', orderItemId: '', plannedQuantityM3: '' });
    setOrderLines([]);
    try {
      setSel(await productionPlansApi.get(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  /** Picking an order fetches its lines: a plan line is grade-specific. */
  async function pickOrder(orderId: string) {
    setItem({ orderId, orderItemId: '', plannedQuantityM3: '' });
    setOrderLines([]);
    if (!orderId) return;
    try {
      const o = await ordersApi.get(orderId);
      const lines = (o.items as Row[]) ?? [];
      setOrderLines(lines);
      if (lines.length === 1) {
        const only = lines[0]!;
        setItem({ orderId, orderItemId: String(only.id), plannedQuantityM3: String(num(only.balanceM3 ?? only.quantityM3)) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  function pickLine(orderItemId: string) {
    const line = orderLines.find((l) => String(l.id) === orderItemId);
    setItem({ ...item, orderItemId, plannedQuantityM3: line ? String(num(line.balanceM3 ?? line.quantityM3)) : '' });
  }

  async function addLine(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    if (!item.orderId) { setError('Pick a confirmed order first.'); return; }
    if (orderLines.length > 1 && !item.orderItemId) { setError('This order has several lines: pick the grade to plan.'); return; }
    await run(async () => {
      const updated = await productionPlansApi.addItem(String(sel.id), {
        orderId: item.orderId,
        ...(item.orderItemId ? { orderItemId: item.orderItemId } : {}),
        plannedQuantityM3: num(item.plannedQuantityM3) || undefined,
      });
      setSel(updated);
      setItem({ orderId: '', orderItemId: '', plannedQuantityM3: '' });
      setOrderLines([]);
    }, 'Line added.');
  }

  async function removeLine(itemId: string) {
    if (!sel) return;
    await run(async () => {
      await productionPlansApi.removeItem(String(sel.id), itemId);
      setSel(await productionPlansApi.get(String(sel.id)));
    }, 'Line removed.');
  }

  async function setPlanStatus(status: string, okMsg: string) {
    if (!sel) return;
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel plan', message: `Cancel ${String(sel.planNo)}? Lines already on the batch queue stay there; the rest will not be batched.`, confirmLabel: 'Cancel plan', danger: true });
      if (!ok) return;
    }
    await run(async () => {
      await productionPlansApi.setStatus(String(sel.id), status);
      setSel(await productionPlansApi.get(String(sel.id)));
    }, okMsg);
  }

  async function enqueue() {
    if (!sel) return;
    await run(async () => {
      const r = (await productionPlansApi.enqueue(String(sel.id))) as Row;
      setSel(await productionPlansApi.get(String(sel.id)));
      const n = num(r.queued);
      return n ? `${n} ${n === 1 ? 'load' : 'loads'} sent to the batch queue.` : 'Every line on this plan was already on the batch queue.';
    });
  }

  const shown = filter ? rows.filter((r) => String(r.status) === filter) : rows;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.status), (m.get(String(r.status)) ?? 0) + 1);
    return m;
  }, [rows]);
  const totalM3 = useMemo(() => shown.reduce((t, r) => (String(r.status) === 'cancelled' ? t : t + num(r.plannedM3)), 0), [shown]);
  const drafts = counts.get('draft') ?? 0;
  const unsent = useMemo(() => rows.filter((r) => String(r.status) === 'confirmed' && num(r.queuedLines) < num(r.lines)).length, [rows]);

  const items = (sel?.items as Row[]) ?? [];
  const selStatus = String(sel?.status ?? '');
  const terminal = TERMINAL.includes(selStatus);
  const unsentLines = items.filter((it) => String(it.status) !== 'queued').length;
  const plannedTotal = items.reduce((t, it) => t + num(it.plannedQuantityM3), 0);
  const chosenLine = orderLines.find((l) => String(l.id) === item.orderItemId);

  return (
    <div className="mn-ord mn-pp">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Production plans</h1>
          <p>The shift&apos;s worksheet: which confirmed orders the plant batches, how much of each, in what order. Confirm the plan, then send its lines to the batch queue; each line becomes a load waiting for the plant.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ClipboardList size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'plan' : 'plans'}
            {' · '}
            {qty(totalM3)} m³ planned
          </span>
          <Link href="/app/production/batch-queue" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<ListOrdered size={14} />}>Batch queue</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Status strip — counts per status; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`}
              data-tone={s.tone}
              aria-pressed={on}
              title={s.hint}
              onClick={() => setFilter(on ? '' : s.key)}
            >
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && (
          <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>
            Show all
          </button>
        )}
      </div>

      {(drafts > 0 || unsent > 0) && !filter && (
        <div className="mn-ord-notes">
          {drafts > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--btn" onClick={() => setFilter('draft')}>
              <ClipboardList size={16} aria-hidden />
              <span><strong>{drafts} draft {drafts === 1 ? 'plan is' : 'plans are'} not confirmed yet.</strong> Open one, check its lines, then Confirm plan.</span>
            </button>
          )}
          {unsent > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('confirmed')}>
              <Send size={16} aria-hidden />
              <span><strong>{unsent} confirmed {unsent === 1 ? 'plan has' : 'plans have'} lines not yet on the batch queue.</strong> Open it and press Send to batch queue; the plant only sees loads that are queued.</span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New plan</span>}>
        <Form onSubmit={create} className="mn-pp-form">
          <Field label="Plant">
            <Select value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
              <option value="">Any plant</option>
              {plants.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.planDate} onChange={(e) => setForm({ ...form, planDate: e.target.value })} required />
          </Field>
          <Field label="Shift">
            <Select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
              <option value="day">Day</option>
              <option value="night">Night</option>
            </Select>
          </Field>
          <div className="mn-pp-form-submit">
            <Button type="submit" icon={<Plus size={14} />} loading={busy}>Create plan</Button>
          </div>
        </Form>
        <p className="mn-board-form-hint">A plan starts empty. Once it exists, add the confirmed orders to batch on that shift, confirm it, and send it to the batch queue.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><CalendarDays size={16} aria-hidden /> Plans <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Press a plan to open its worksheet below.</span>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : shown.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Plan</span>
              <span>Plant · customers</span>
              <span>Planned</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const status = String(r.status ?? '');
              const on = sel && String(sel.id) === String(r.id);
              const lines = num(r.lines);
              const queued = num(r.queuedLines);
              const customers = (r.customerNames as string[] | undefined) ?? [];
              return (
                <div
                  key={String(r.id)}
                  className={`mn-ord-row mn-ord-row--acts mn-pp-row${on ? ' is-on' : ''}`}
                  data-tone={toneOf(status)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={!!on}
                  onClick={() => open(String(r.id))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(String(r.id)); } }}
                >
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.planNo ?? '')}</span>
                    <span className="mn-ord-meta">{dayLabel(r.planDate)}<span className="mn-ord-dot" aria-hidden>·</span>{shiftLabel(r.shift)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.plantName ?? 'Any plant')}</span>
                    <span className="mn-ord-meta">{customers.length ? customers.join(', ') : 'No lines yet'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{qty(r.plannedM3)} m³</span>
                    <span className="mn-ord-meta">{lines ? `${lines} ${lines === 1 ? 'line' : 'lines'} · ${queued} queued` : 'Nothing planned'}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={status} /></div>
                  <div className="mn-ord-act mn-pp-acts">
                    <Button variant={on ? 'ghost' : 'secondary'} size="sm" onClick={(e) => { e.stopPropagation(); open(String(r.id)); }}>{on ? 'Open below' : 'Open'}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : filter ? (
          <EmptyState title={`No ${labelOf(filter)} plans`} description="Press the chip again to show every plan." />
        ) : (
          <EmptyState title="No plans yet" description="Create the shift's plan above, add the confirmed orders to batch, and send it to the batch queue." />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="plans" />
      </Card>

      {sel && (
        <div className="mn-pp-ws">
        <Card
          title={
            <span className="mn-board-card-title">
              <ClipboardList size={16} aria-hidden /> {String(sel.planNo)}
              <span className="mn-pp-sub">{dayLabel(sel.planDate)} · {shiftLabel(sel.shift)}{sel.plantName ? ` · ${String(sel.plantName)}` : ''}</span>
              <StatusBadge status={selStatus} />
            </span>
          }
          actions={
            <div className="mn-pp-tools">
              {selStatus === 'draft' && <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => setPlanStatus('confirmed', 'Plan confirmed. Send it to the batch queue when the plant is ready.')} disabled={busy || !items.length}>Confirm plan</Button>}
              {!terminal && (
                <Button size="sm" variant={selStatus === 'draft' ? 'secondary' : undefined} icon={<Send size={14} />} onClick={enqueue} disabled={busy || !items.length || (unsentLines === 0 && selStatus !== 'in_progress')}>
                  Send to batch queue
                </Button>
              )}
              {selStatus === 'in_progress' && <Button size="sm" variant="secondary" icon={<CheckCircle2 size={14} />} onClick={() => setPlanStatus('completed', 'Plan marked completed.')} disabled={busy}>Mark completed</Button>}
              {(selStatus === 'draft' || selStatus === 'confirmed') && <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => setPlanStatus('cancelled', 'Plan cancelled.')} disabled={busy}>Cancel plan</Button>}
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setSel(null)} aria-label="Close worksheet">Close</Button>
            </div>
          }
          padded={false}
        >
          <p className="mn-pp-hint">
            {selStatus === 'draft'
              ? 'Add the confirmed orders to batch on this shift. When the list is right, Confirm plan; then Send to batch queue turns each line into a load the plant sees.'
              : selStatus === 'confirmed'
                ? (unsentLines ? `${unsentLines} ${unsentLines === 1 ? 'line is' : 'lines are'} not on the batch queue yet. Press Send to batch queue when the plant is ready to start.` : 'Every line is on the batch queue.')
                : selStatus === 'in_progress'
                  ? 'The plant is working through this plan on the batch queue. Lines added now can be sent with the button above; mark it completed once the last load is batched.'
                  : selStatus === 'completed'
                    ? 'A record of the shift: every line was batched.'
                    : 'This plan was cancelled. Lines that had reached the batch queue stayed there.'}
          </p>
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Order</Th>
                  <Th>Site · pour</Th>
                  <Th>Grade</Th>
                  <Th numeric>Planned m³</Th>
                  <Th>Queue</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const q = queueCell(it);
                  const ordered = num(it.orderedQtyM3);
                  return (
                    <tr key={String(it.id)}>
                      <Td><span className="mn-ord-meta">{i + 1}</span></Td>
                      <Td>
                        {it.orderId ? <Link href={`/app/orders/${String(it.orderId)}`} className="mn-id-link">{String(it.orderNo ?? 'Order')}</Link> : '—'}
                        <span className="mn-od-rate-meta">{String(it.customerName ?? '—')}</span>
                      </Td>
                      <Td>
                        <span>{String(it.siteName ?? '—')}</span>
                        <span className="mn-od-rate-meta">{it.requiredDatetime ? `Pour ${formatDateTime(it.requiredDatetime)}` : 'No pour time'}</span>
                      </Td>
                      <Td><span className="mn-od-grade">{String(it.gradeLabel ?? '—')}</span></Td>
                      <Td numeric>
                        <span className="mn-od-num">{qty(it.plannedQuantityM3)}</span>
                        {ordered > 0 ? <span className="mn-od-rate-meta">of {qty(ordered)} ordered</span> : null}
                      </Td>
                      <Td>
                        <Badge tone={q.tone}>{q.label}</Badge>
                        <span className="mn-od-rate-meta">{q.note}</span>
                      </Td>
                      <Td>
                        {!terminal && String(it.status) !== 'queued' && (
                          <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => removeLine(String(it.id))} disabled={busy} aria-label={`Remove line ${i + 1}`}>Remove</Button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr><Td colSpan={7}><span className="mn-ord-meta">No lines yet: add the first order below.</span></Td></tr>
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr className="mn-pp-total">
                    <Td colSpan={4}>{items.length} {items.length === 1 ? 'line' : 'lines'} · {items.length - unsentLines} on the queue</Td>
                    <Td numeric><span className="mn-od-num">{qty(plannedTotal)}</span></Td>
                    <Td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>

          {!terminal && (
            <Form onSubmit={addLine} className="mn-pp-line">
              <Field label="Confirmed order" required>
                <Select value={item.orderId} onChange={(e) => pickOrder(e.target.value)} required>
                  <option value="">Pick an order</option>
                  {orders.map((o) => (
                    <option key={String(o.id)} value={String(o.id)}>{String(o.orderNo)}{o.customerName ? ` · ${String(o.customerName)}` : ''}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Grade (order line)" required={orderLines.length > 1}>
                <Select value={item.orderItemId} onChange={(e) => pickLine(e.target.value)} disabled={orderLines.length <= 1}>
                  {orderLines.length === 0 && <option value="">{item.orderId ? 'Loading lines…' : 'Pick the order first'}</option>}
                  {orderLines.length > 1 && <option value="">Pick the grade</option>}
                  {orderLines.map((l) => (
                    <option key={String(l.id)} value={String(l.id)}>{String(l.gradeLabel ?? 'Line')} · {qty(l.quantityM3)} m³{l.balanceM3 != null ? ` (${qty(l.balanceM3)} left)` : ''}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Planned m³" help={chosenLine ? `Up to ${qty(chosenLine.quantityM3)} m³ ordered on this line` : undefined}>
                <Input type="number" step="any" inputMode="decimal" min={0} value={item.plannedQuantityM3} onChange={(e) => setItem({ ...item, plannedQuantityM3: e.target.value })} placeholder="Whole line" />
              </Field>
              <div className="mn-pp-line-submit">
                <Button type="submit" variant="secondary" icon={<Plus size={14} />} disabled={busy || !item.orderId}>Add line</Button>
              </div>
            </Form>
          )}
        </Card>
        </div>
      )}
    </div>
  );
}
