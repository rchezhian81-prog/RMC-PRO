'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ClipboardList, RefreshCw, Truck } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { ordersApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Order book — what is still to pour.
 *
 * A stage strip (to pour / on the road / done) with live counts doubles as
 * the filter, five tiles carry the m³ ordered, batched, delivered, on the
 * road and still to pour, and each confirmed order is one row: the number
 * and date; the customer; a bar of delivered and batched against ordered
 * with the figures; the balance; the stage. A foot totals the book. Same
 * layout in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const m3 = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'to_pour', label: 'To pour', tone: 'warning', hint: 'Ordered m³ not yet batched' },
  { key: 'on_road', label: 'On the road', tone: 'info', hint: 'Batched and dispatched, not yet delivered' },
  { key: 'done', label: 'Done', tone: 'success', hint: 'Everything ordered has been delivered' },
];
const stageOf = (r: Row) => (num(r.balance) > 0 ? 'to_pour' : num(r.pending) > 0 ? 'on_road' : 'done');
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;

export default function OrderBookPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setData(await ordersApi.orderBook());
  }, []);
  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const t = data?.totals;
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(stageOf(r), (c.get(stageOf(r)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = useMemo(() => {
    const list = filter ? rows.filter((r) => stageOf(r) === filter) : rows;
    const order: Record<string, number> = { to_pour: 0, on_road: 1, done: 2 };
    return [...list].sort((a, b) => (order[stageOf(a)] ?? 9) - (order[stageOf(b)] ?? 9) || num(b.balance) - num(a.balance));
  }, [rows, filter]);
  const toPour = counts.get('to_pour') ?? 0;

  return (
    <div className="mn-ord mn-ob">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Order book</h1>
          <p>Every confirmed order and how much of it is done: ordered, batched at the plant, delivered to site, and what is still to pour. The balance is what the plant still owes its customers; it is tomorrow's production plan.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <BookOpen size={14} aria-hidden />
            {loaded ? `${rows.length} ${rows.length === 1 ? 'order' : 'orders'} · ${m3(t?.balance)} m³ to pour` : 'Loading…'}
          </span>
          <ExportButton rows={rows} columns={['orderNo', 'orderDate', 'customerName', 'ordered', 'batched', 'delivered', 'pending', 'balance']} filename="order-book" />
          <Link href="/app/orders" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ClipboardList size={14} />}>Orders</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="mn-board-strip" role="group" aria-label="Filter by stage">
        {STAGES.map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button key={s.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`} data-tone={s.tone} aria-pressed={on} title={s.hint} onClick={() => setFilter(on ? '' : s.key)}>
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
      </div>

      {loaded && !filter && toPour > 0 && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('to_pour')}>
            <Truck size={16} aria-hidden />
            <span><strong>{m3(t?.balance)} m³ still to pour</strong> across {toPour} {toPour === 1 ? 'order' : 'orders'}{num(t?.pending) > 0 ? `, and ${m3(t?.pending)} m³ on the road right now` : ''}. Plan the batches under Production.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Ordered" value={t ? `${m3(t.ordered)} m³` : '—'} />
        <StatCard label="Batched" value={t ? `${m3(t.batched)} m³` : '—'} tone="info" />
        <StatCard label="Delivered" value={t ? `${m3(t.delivered)} m³` : '—'} tone="success" />
        <StatCard label="On the road" value={t ? `${m3(t.pending)} m³` : '—'} tone={num(t?.pending) > 0 ? 'info' : 'neutral'} />
        <StatCard label="Still to pour" value={t ? `${m3(t.balance)} m³` : '—'} tone={num(t?.balance) > 0 ? 'warning' : 'success'} />
      </div>

      <Card
        title={<span className="mn-board-card-title"><BookOpen size={16} aria-hidden /> Confirmed orders <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Largest balance first. Batched is what the plant made; delivered is what reached the site, net of returns.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ob-cols" aria-hidden>
              <span>Order</span>
              <span>Customer</span>
              <span>Progress</span>
              <span className="is-num">To pour</span>
              <span>Stage</span>
            </div>
            {shown.map((r, i) => {
              const stage = stageOf(r);
              const ordered = Math.max(num(r.ordered), 0.0001);
              const delivered = Math.min(100, (num(r.delivered) / ordered) * 100);
              const batched = Math.min(100, (num(r.batched) / ordered) * 100);
              return (
                <div key={`${String(r.orderNo)}-${i}`} className="mn-ord-row mn-ob-row" data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.orderNo)}</span>
                    <span className="mn-ord-meta">{formatDate(r.orderDate)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">{m3(r.ordered)} m³ ordered</span>
                  </div>
                  <div className="mn-ob-progress">
                    <span className="mn-ob-bar" aria-hidden>
                      <span className="mn-ob-bar-batched" style={{ width: `${batched}%` }} />
                      <span className="mn-ob-bar-delivered" style={{ width: `${delivered}%` }} />
                    </span>
                    <span className="mn-ord-meta">delivered {m3(r.delivered)} · batched {m3(r.batched)}{num(r.pending) > 0 ? ` · on the road ${m3(r.pending)}` : ''}{num(r.returned) > 0 ? ` · returned ${m3(r.returned)}` : ''}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className={`mn-ord-amt${num(r.balance) > 0 ? '' : ' mn-st-in'}`}>{m3(r.balance)} m³</span>
                  </div>
                  <div className="mn-ord-status">{stage === 'done' ? <Badge tone="success">done</Badge> : stage === 'on_road' ? <Badge tone="info">on the road</Badge> : <Badge tone="warning">to pour</Badge>}</div>
                </div>
              );
            })}
            {t && !filter && (
              <div className="mn-ord-row mn-ob-row mn-ob-foot" data-tone="neutral" aria-label="All orders">
                <div className="mn-ord-id"><span className="mn-ord-no">All orders</span><span className="mn-ord-meta">{num(t.count)} confirmed</span></div>
                <div className="mn-ord-who"><span className="mn-ord-meta">{m3(t.ordered)} m³ ordered</span></div>
                <div className="mn-ob-progress"><span className="mn-ord-meta">delivered {m3(t.delivered)} · batched {m3(t.batched)}{num(t.pending) > 0 ? ` · on the road ${m3(t.pending)}` : ''}</span></div>
                <div className="mn-ord-val"><span className="mn-ord-amt">{m3(t.balance)} m³</span></div>
                <div className="mn-ord-status" />
              </div>
            )}
          </div>
        ) : (
          <EmptyState title={filter ? `Nothing ${labelOf(filter)}` : 'No confirmed orders'} description={filter ? 'Press the chip again to see every order.' : 'Confirmed orders appear here with what is still to pour.'} action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button> : undefined} />
        )}
      </Card>
    </div>
  );
}
