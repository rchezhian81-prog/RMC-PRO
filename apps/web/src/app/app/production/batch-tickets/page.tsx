'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ClipboardList, FileText, ListOrdered, RefreshCw, Scale, ShieldAlert } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { batchTicketsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Batch tickets — every batch the plant has mixed, as one row each.
 *
 * A status strip (draft / confirmed / cancelled) with live counts doubles as
 * the filter, a summary pill totals the concrete on screen, and each ticket is
 * one tappable row: number and start time, the order and customer it was
 * mixed for and who ran it, the quantity with the grade under it, how
 * accurately it was weighed (materials off tolerance, and the worst miss),
 * the status, and the way in. Drafts waiting to be confirmed and batches that
 * breached tolerance get a note above the list. Same layout in both skins;
 * every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'neutral', hint: 'Started from the queue; actuals can still be entered. Stock is untouched until it is confirmed' },
  { key: 'confirmed', label: 'Confirmed', tone: 'success', hint: 'Locked; the materials actually used have been deducted from stock' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Abandoned before confirmation; nothing was deducted' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;

/** How accurately the batch was weighed, as the fourth column reads it. */
function accuracy(r: Row): { label: string; note: string; tone: Tone } {
  const status = String(r.status ?? '');
  const materials = num(r.materials);
  const weighed = num(r.weighed);
  const breaches = num(r.breaches);
  const worst = num(r.worstPct);
  if (status === 'cancelled') return { label: 'Not weighed', note: 'Cancelled', tone: 'neutral' };
  if (!materials) return { label: 'No materials', note: 'No mix design on this ticket', tone: 'neutral' };
  if (!weighed) return { label: 'No actuals yet', note: `${materials} ${materials === 1 ? 'material' : 'materials'} to weigh`, tone: status === 'draft' ? 'warning' : 'neutral' };
  if (breaches > 0) {
    return {
      label: `${breaches} of ${materials} off tolerance`,
      note: `Worst ±${worst.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%${r.varianceExceeded && status === 'confirmed' ? ' · confirmed with override' : ''}`,
      tone: 'danger',
    };
  }
  return { label: 'Within tolerance', note: `${weighed} of ${materials} weighed · worst ±${worst.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`, tone: 'success' };
}

export default function BatchTicketsPage() {
  // `all` is the newest window of every status: it feeds the counts on the
  // strip and is what shows when no chip is pressed. Pressing a chip asks the
  // API for that status alone, so an old cancelled ticket is still reachable
  // even when the unfiltered window is full of newer ones.
  const [all, setAll] = useState<Row[]>([]);
  const [filtered, setFiltered] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [onlyBreaches, setOnlyBreaches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [everything, some] = await Promise.all([
      batchTicketsApi.list(undefined, win.limit),
      filter ? batchTicketsApi.list(filter, win.limit) : Promise.resolve<Row[]>([]),
    ]);
    setAll(everything);
    setFiltered(some);
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

  const base = filter ? filtered : all;
  const rows = useMemo(() => (onlyBreaches ? base.filter((r) => num(r.breaches) > 0) : base), [base, onlyBreaches]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) m.set(String(r.status), (m.get(String(r.status)) ?? 0) + 1);
    return m;
  }, [all]);
  const totalM3 = useMemo(
    () => rows.reduce((t, r) => (String(r.status) === 'cancelled' ? t : t + num(r.batchQuantityM3)), 0),
    [rows],
  );
  const drafts = counts.get('draft') ?? 0;
  const breached = useMemo(() => all.filter((r) => String(r.status) !== 'cancelled' && num(r.breaches) > 0).length, [all]);

  return (
    <div className="mn-ord mn-bt">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Batch tickets</h1>
          <p>One ticket per batch mixed: the design targets, what was actually weighed, and the variance. Confirming a ticket locks it and takes the materials used out of stock.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Scale size={14} aria-hidden />
            {rows.length} {filter ? labelOf(filter) : ''} {rows.length === 1 ? 'ticket' : 'tickets'}
            {' · '}
            {qty(totalM3)} m³
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
        {onlyBreaches && (
          <button type="button" className="mn-board-chip is-on" data-tone="danger" aria-pressed onClick={() => setOnlyBreaches(false)}>
            <span className="mn-board-chip-n">{rows.length}</span>
            <span className="mn-board-chip-l">Off tolerance</span>
          </button>
        )}
        {(filter || onlyBreaches) && (
          <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => { setFilter(''); setOnlyBreaches(false); }}>
            Show all
          </button>
        )}
      </div>

      {(drafts > 0 || breached > 0) && !filter && !onlyBreaches && (
        <div className="mn-ord-notes">
          {breached > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setOnlyBreaches(true)}>
              <ShieldAlert size={16} aria-hidden />
              <span>
                <strong>{breached} {breached === 1 ? 'batch' : 'batches'} weighed a material outside its tolerance.</strong>{' '}
                Press to see them; open a ticket to see which material and by how much.
              </span>
            </button>
          )}
          {drafts > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('draft')}>
              <ClipboardList size={16} aria-hidden />
              <span>
                <strong>{drafts} {drafts === 1 ? 'ticket is' : 'tickets are'} still draft.</strong>{' '}
                Stock is not deducted until a ticket is confirmed. Press to see them.
              </span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Batches <span className="mn-board-card-count">{rows.length}</span></span>}
        actions={
          <span className="mn-ord-how">
            No “new ticket” button: press <em>Start batch</em> on a waiting load in{' '}
            <Link href="/app/production/batch-queue">Production → Batch queue</Link>, then enter the actuals and confirm.
          </span>
        }
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : rows.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols" aria-hidden>
              <span>Ticket</span>
              <span>For · batched by</span>
              <span className="is-num">Quantity</span>
              <span>Accuracy</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map((r) => {
              const status = String(r.status ?? '');
              const a = accuracy(r);
              return (
                <Link key={String(r.id)} href={`/app/production/batch-tickets/${r.id}`} className={`mn-ord-row${status === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(status)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.batchTicketNo ?? '')}</span>
                    <span className="mn-ord-meta">
                      {formatDateTime(r.batchStartTime ?? r.createdAt)}
                      <span className="mn-ord-dot" aria-hidden>·</span>
                      {String(r.sourceType) === 'controller' ? 'From controller' : 'Manual'}
                    </span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? (r.orderNo ? `Order ${String(r.orderNo)}` : 'No order'))}</span>
                    <span className="mn-ord-meta">
                      {r.customerName && r.orderNo ? String(r.orderNo) : null}
                      {r.customerName && r.orderNo && r.operatorName ? <span className="mn-ord-dot" aria-hidden>·</span> : null}
                      {r.operatorName ? `Batched by ${String(r.operatorName)}` : r.customerName && r.orderNo ? null : 'Operator not recorded'}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{qty(r.batchQuantityM3)} m³</span>
                    <span className="mn-ord-meta">{String(r.gradeLabel ?? 'No grade')}</span>
                  </div>
                  <div className="mn-ord-when" data-tone={a.tone}>
                    <span className="mn-ord-when-d">{a.label}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{a.note}</span>
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={status} />
                    {r.varianceExceeded && status === 'confirmed' ? <Badge tone="warning">override</Badge> : null}
                  </div>
                  <div className="mn-ord-go" aria-hidden><ChevronRight size={18} /></div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={onlyBreaches ? 'Nothing off tolerance' : filter ? `No ${labelOf(filter)} tickets` : 'No batch tickets yet'}
            description={
              onlyBreaches
                ? 'Every weighed material on screen is within its tolerance.'
                : filter
                  ? 'Nothing in this status right now. Press the chip again to see every ticket.'
                  : 'A ticket is created when you start a batch from a waiting load in the batch queue.'
            }
            action={
              filter || onlyBreaches ? (
                <Button variant="secondary" size="sm" onClick={() => { setFilter(''); setOnlyBreaches(false); }}>Show all tickets</Button>
              ) : (
                <Link href="/app/production/batch-queue"><Button size="sm">Go to Batch queue</Button></Link>
              )
            }
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="tickets" hint="the production reports" />
        {/* Phones: the same guidance, under the list instead of beside the title. */}
        <p className="mn-ord-how mn-ord-how--foot">
          No “new ticket” button: press <em>Start batch</em> on a waiting load in <Link href="/app/production/batch-queue">Production → Batch queue</Link>, then enter the actuals and confirm.
        </p>
      </Card>
    </div>
  );
}
