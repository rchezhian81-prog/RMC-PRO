'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList, FileCheck2, FileText, ListOrdered, PauseCircle, Play, PlayCircle, Plus, RefreshCw, Scale, XCircle } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { batchQueueApi, batchTicketsApi, mixDesignsApi, ordersApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Batch queue — the loads waiting for the plant.
 *
 * A status strip (waiting / batching / held / completed / cancelled) with
 * live counts doubles as the filter, a summary pill totals the concrete still
 * to batch on screen, and each load is one row: the grade with the order it
 * came from, the customer and site with the pour time, how much is left to
 * batch with a progress bar, the mix design to batch it with, the status, and
 * the actions the state allows (Start batch, Hold, Resume, Cancel). Held loads
 * and loads with a draft ticket still open get a note above the list. The
 * "send a confirmed order to the queue" form keeps its place above the list.
 * Same layout in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'waiting', label: 'Waiting', tone: 'info', hint: 'Queued and ready; press Start batch to raise a ticket' },
  { key: 'batching', label: 'Batching', tone: 'warning', hint: 'A ticket is open against this load; the plant is on it' },
  { key: 'held', label: 'Held', tone: 'warning', hint: 'Paused on purpose (site not ready, pump late); Resume puts it back' },
  { key: 'completed', label: 'Completed', tone: 'success', hint: 'The planned quantity has been batched' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn; the order line can be queued again' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;

export default function BatchQueuePage() {
  const router = useRouter();
  const { prompt, confirm } = useConfirm();
  // `all` is the newest window of every status: it feeds the counts on the
  // strip and is what shows when no chip is pressed. Pressing a chip asks the
  // API for that status alone, so an old completed load is still reachable
  // even when the unfiltered window is full of newer ones.
  const [all, setAll] = useState<Row[]>([]);
  const [filtered, setFiltered] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [orders, setOrders] = useState<Row[]>([]);
  const [mixes, setMixes] = useState<Row[]>([]);
  const [mixByRow, setMixByRow] = useState<Record<string, string>>({});
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [everything, some, o, mx] = await Promise.all([
      batchQueueApi.list(undefined, win.limit),
      filter ? batchQueueApi.list(filter, win.limit) : Promise.resolve<Row[]>([]),
      ordersApi.list('confirmed'),
      mixDesignsApi.list(),
    ]);
    setAll(everything);
    setFiltered(some);
    setOrders(o);
    setMixes(mx);
  }, [filter, win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function setQueueStatus(r: Row, status: string, okMsg: string) {
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel load', message: `Cancel the queued ${String(r.gradeLabel ?? '')} load for ${String(r.customerName ?? 'this order')}? The order line can be sent to the queue again later.`, confirmLabel: 'Cancel load' });
      if (!ok) return;
    }
    await run(async () => {
      await batchQueueApi.setStatus(String(r.id), status);
      await reload();
    }, okMsg);
  }

  async function enqueue(e: FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setSending(true);
    try {
      await run(async () => {
        const created = (await batchQueueApi.enqueueFromOrder(orderId)) as unknown;
        const n = Array.isArray(created) ? created.length : 0;
        setOrderId('');
        await reload();
        setMsg(n === 0 ? 'Every line of that order is already in the queue.' : `${n} ${n === 1 ? 'load' : 'loads'} sent to the queue.`);
      });
    } finally {
      setSending(false);
    }
  }

  async function startBatch(entry: Row) {
    const remaining = Math.max(0, num(entry.plannedQuantityM3) - num(entry.producedQuantityM3));
    const qtyStr = await prompt({
      title: 'Start batch',
      message: `${String(entry.gradeLabel ?? 'This load')} for ${String(entry.customerName ?? 'the order')}: ${qty(remaining)} m³ still to batch. A ticket opens with the design targets; enter the actuals on it and confirm to take stock.`,
      label: 'Batch quantity (m³)',
      defaultValue: String(remaining),
      type: 'number',
      confirmLabel: 'Start',
    });
    if (qtyStr === null) return;
    // Optional explicit mix design — falls back to the grade's approved mix when
    // left on "Auto". Lets an operator proceed even if the queue line's grade
    // can't auto-resolve a mix.
    const mixDesignId = mixByRow[String(entry.id)] || undefined;
    await run(async () => {
      const ticket = await batchTicketsApi.createFromQueue(String(entry.id), { batchQuantityM3: Number(qtyStr), mixDesignId });
      router.push(`/app/production/batch-tickets/${ticket.id}`);
    });
  }

  const rows = filter ? filtered : all;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) m.set(String(r.queueStatus), (m.get(String(r.queueStatus)) ?? 0) + 1);
    return m;
  }, [all]);
  const toBatch = useMemo(
    () => rows.reduce((t, r) => (['waiting', 'batching', 'held'].includes(String(r.queueStatus)) ? t + Math.max(0, num(r.plannedQuantityM3) - num(r.producedQuantityM3)) : t), 0),
    [rows],
  );
  const held = counts.get('held') ?? 0;
  const drafts = useMemo(() => all.filter((r) => num(r.drafts) > 0).length, [all]);
  const approvedMixes = useMemo(() => mixes.filter((mx) => String(mx.approvalStatus) === 'approved'), [mixes]);

  return (
    <div className="mn-ord mn-bq">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Batch queue</h1>
          <p>One load per order line, waiting for the plant. Start a batch to open a ticket with the design targets; the load completes when the planned quantity has been batched.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Scale size={14} aria-hidden />
            {rows.length} {filter ? labelOf(filter) : ''} {rows.length === 1 ? 'load' : 'loads'}
            {' · '}
            {qty(toBatch)} m³ to batch
          </span>
          <Link href="/app/production/batch-tickets" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<ListOrdered size={14} />}>Batch tickets</Button>
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

      {(held > 0 || drafts > 0) && !filter && (
        <div className="mn-ord-notes">
          {held > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('held')}>
              <PauseCircle size={16} aria-hidden />
              <span>
                <strong>{held} {held === 1 ? 'load is' : 'loads are'} on hold.</strong> Press to see them; Resume puts a load back in the queue.
              </span>
            </button>
          )}
          {drafts > 0 && (
            <Link href="/app/production/batch-tickets" className="mn-ord-note mn-ord-note--warn">
              <ClipboardList size={16} aria-hidden />
              <span>
                <strong>{drafts} {drafts === 1 ? 'load has' : 'loads have'} a draft ticket not yet confirmed.</strong> Stock is not deducted until the ticket is confirmed. Open Batch tickets to finish them.
              </span>
            </Link>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><FileCheck2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> Send a confirmed order to the queue</span>}>
        <Form onSubmit={enqueue} className="mn-bq-form">
          <Field label="Confirmed order" required>
            <select className="mn-input" value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
              <option value="">— select —</option>
              {orders.map((o) => (
                <option key={String(o.id)} value={String(o.id)}>
                  {String(o.orderNo)} · {String(o.customerName ?? 'Customer')}{o.requiredDatetime ? ` · pour ${formatDateTime(o.requiredDatetime)}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="mn-bq-form-submit">
            <Button type="submit" loading={sending} disabled={!orderId}>Send to queue</Button>
          </div>
        </Form>
        <p className="mn-board-form-hint">One load is queued per order line. A line already in the queue is skipped, so sending an order twice does nothing.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Loads <span className="mn-board-card-count">{rows.length}</span></span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : rows.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Load</span>
              <span>Customer · pour</span>
              <span className="is-num">To batch</span>
              <span>Mix design</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map((r) => {
              const st = String(r.queueStatus ?? '');
              const planned = num(r.plannedQuantityM3);
              const produced = num(r.producedQuantityM3);
              const remaining = Math.max(0, planned - produced);
              const pct = planned > 0 ? Math.min(100, Math.round((produced / planned) * 100)) : 0;
              const live = st === 'waiting' || st === 'batching';
              const gradeMixes = approvedMixes.filter((mx) => !r.gradeId || !mx.gradeId || String(mx.gradeId) === String(r.gradeId));
              const tickets = num(r.tickets);
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts${st === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(st)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.gradeLabel ?? 'No grade')}</span>
                    <span className="mn-ord-meta">
                      {r.orderId ? <Link href={`/app/orders/${String(r.orderId)}`} className="mn-id-link">{String(r.orderNo ?? 'Order')}</Link> : 'No order'}
                      {r.siteName ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.siteName)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">{r.requiredDatetime ? `Pour ${formatDateTime(r.requiredDatetime)}` : 'No pour time on the order'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{st === 'completed' ? `${qty(produced)} m³` : `${qty(remaining)} m³`}</span>
                    <span className="mn-ord-meta">{st === 'completed' ? 'batched in full' : `${qty(produced)} of ${qty(planned)} m³ batched`}</span>
                    <span className="mn-bq-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
                  </div>
                  <div className="mn-ord-when mn-bq-mix">
                    {live ? (
                      <>
                        <select
                          className="mn-input"
                          value={mixByRow[String(r.id)] ?? ''}
                          onChange={(e) => setMixByRow({ ...mixByRow, [String(r.id)]: e.target.value })}
                          aria-label="Mix design"
                          title="Mix design — defaults to the grade's approved mix"
                        >
                          <option value="">Auto by grade</option>
                          {gradeMixes.map((mx) => (
                            <option key={String(mx.id)} value={String(mx.id)}>{String(mx.mixCode ?? mx.id)}</option>
                          ))}
                        </select>
                        <span className="mn-ord-meta">{tickets > 0 ? `${tickets} ${tickets === 1 ? 'ticket' : 'tickets'} so far · last ${String(r.lastTicketNo ?? '')}` : 'No ticket yet'}</span>
                      </>
                    ) : (
                      <>
                        <span className="mn-ord-when-d">{tickets > 0 ? `${tickets} ${tickets === 1 ? 'ticket' : 'tickets'}` : 'No ticket'}</span>
                        <span className="mn-ord-meta mn-ord-when-m">{r.lastTicketNo ? `Last ${String(r.lastTicketNo)}` : st === 'held' ? 'Resume to batch it' : '—'}</span>
                      </>
                    )}
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={st} /></div>
                  <div className="mn-ord-go mn-bq-acts">
                    {live && (
                      <Button size="sm" icon={<Play size={14} />} onClick={() => startBatch(r)}>Start batch</Button>
                    )}
                    {st === 'waiting' && (
                      <Button variant="ghost" size="sm" icon={<PauseCircle size={14} />} onClick={() => setQueueStatus(r, 'held', 'Load held')}>Hold</Button>
                    )}
                    {st === 'held' && (
                      <Button variant="secondary" size="sm" icon={<PlayCircle size={14} />} onClick={() => setQueueStatus(r, 'waiting', 'Load resumed')}>Resume</Button>
                    )}
                    {(st === 'waiting' || st === 'held') && (
                      <Button variant="ghost" size="sm" icon={<XCircle size={14} />} onClick={() => setQueueStatus(r, 'cancelled', 'Load cancelled')}>Cancel</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} loads` : 'The queue is empty'}
            description={filter ? 'Nothing in this status right now. Press the chip again to see every load.' : 'Send a confirmed order to the queue above. Each of its lines becomes a load the plant can batch.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all loads</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="loads" hint="the production reports" />
      </Card>
    </div>
  );
}
