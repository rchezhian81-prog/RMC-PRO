'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight, ClipboardList, FileText, RefreshCw, ShieldAlert } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../lib/format-date';
import { useListWindow } from '../../../lib/list-window';
import { ListCap } from '../../../components/ListCap';
import { ordersApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * Orders — the order book at a glance.
 *
 * A status strip (draft / confirmed / credit hold / cancelled) with live counts
 * doubles as the filter, a summary pill totals what is on screen, and each
 * order is one tappable row: number and date, who it is for, the agreed value
 * (with the GST-inclusive figure underneath), the credit verdict and the
 * status. Same layout in both skins; every colour reads the semantic tokens.
 */

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
/** Indian short form for the summary pill: ₹9.8 L, ₹1.71 Cr. */
function moneyShort(v: number): string {
  if (v >= 1e7) return '₹' + (v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr';
  if (v >= 1e5) return '₹' + (v / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' L';
  return money(v);
}
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'info', hint: 'Converted from a quotation, waiting to be confirmed' },
  { key: 'confirmed', label: 'Confirmed', tone: 'success', hint: 'Credit-checked and booked for production' },
  { key: 'credit_hold', label: 'Credit hold', tone: 'warning', hint: 'Over the customer’s limit; needs approval' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn before delivery' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const sourceLabel = (s: unknown) => (String(s ?? '') === 'rate_contract' ? 'Rate contract' : String(s ?? '') === 'quotation' ? 'Quotation' : '—');

export default function OrdersPage() {
  // `all` is the newest window of every status: it feeds the counts on the
  // strip and is what shows when no chip is pressed. Pressing a chip asks the
  // API for that status alone, so an old cancelled order is still reachable
  // even when the unfiltered window is full of newer ones.
  const [all, setAll] = useState<Row[]>([]);
  const [filtered, setFiltered] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [everything, some] = await Promise.all([
      ordersApi.list(undefined, win.limit),
      filter ? ordersApi.list(filter, win.limit) : Promise.resolve<Row[]>([]),
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

  const rows = filter ? filtered : all;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) m.set(String(r.orderStatus), (m.get(String(r.orderStatus)) ?? 0) + 1);
    return m;
  }, [all]);
  const totalValue = useMemo(() => rows.reduce((t, r) => t + num(r.estimatedOrderValue), 0), [rows]);
  const holds = counts.get('credit_hold') ?? 0;

  return (
    <div className="mn-ord">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Orders</h1>
          <p>Every order carries an agreed price from an approved quotation or rate contract. Confirm drafts here; over-limit bookings stop on credit hold for approval.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ClipboardList size={14} aria-hidden />
            {rows.length} {filter ? STATUSES.find((s) => s.key === filter)?.label.toLowerCase() : ''} {rows.length === 1 ? 'order' : 'orders'}
            {' · '}
            {moneyShort(totalValue)} est. value
          </span>
          <Link href="/app/orders/order-book" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<BookOpen size={14} />}>Order book</Button>
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

      {holds > 0 && !filter && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <ShieldAlert size={16} aria-hidden />
          <span>
            <strong>{holds} {holds === 1 ? 'order is' : 'orders are'} on credit hold.</strong> Open each one to review the customer’s exposure and approve or cancel it.
          </span>
        </div>
      )}

      {error && <ErrorState message={error} />}

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Order book <span className="mn-board-card-count">{rows.length}</span></span>}
        actions={
          <span className="mn-ord-how">
            No “new order” button: raise one from{' '}
            <Link href="/app/sales/quotations">Sales → Quotations</Link> (Convert → Order draft) or a{' '}
            <Link href="/app/sales/rate-contracts">rate contract</Link>.
          </span>
        }
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : rows.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols" aria-hidden>
              <span>Order</span>
              <span>Customer</span>
              <span className="is-num">Est. value</span>
              <span>Credit</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map((r) => {
              const status = String(r.orderStatus ?? '');
              return (
                <Link key={String(r.id)} href={`/app/orders/${r.id}`} className="mn-ord-row" data-tone={toneOf(status)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.orderNo ?? '')}</span>
                    <span className="mn-ord-meta">
                      {formatDate(r.orderDate)}
                      <span className="mn-ord-dot" aria-hidden>·</span>
                      {sourceLabel(r.pricingSource)}
                    </span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">
                      {r.requiredDatetime ? <>Needed {formatDateTime(r.requiredDatetime)}</> : 'No pour date yet'}
                      {r.pricingType ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.pricingType) === 'credit' ? 'On credit' : 'Cash'}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.estimatedOrderValue)}</span>
                    <span className="mn-ord-meta">{money(r.estimatedOrderValueInclGst)} incl. GST</span>
                  </div>
                  <div className="mn-ord-credit"><StatusBadge status={String(r.creditStatus ?? 'not_checked')} /></div>
                  <div className="mn-ord-status"><StatusBadge status={status} /></div>
                  <div className="mn-ord-go" aria-hidden><ChevronRight size={18} /></div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${STATUSES.find((s) => s.key === filter)?.label.toLowerCase()} orders` : 'No orders yet'}
            description={filter ? 'Nothing in this status right now. Press the chip again to see every order.' : 'Orders appear here once you convert an approved quotation. Start in Sales → Quotations.'}
            action={
              filter ? (
                <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all orders</Button>
              ) : (
                <Link href="/app/sales/quotations"><Button size="sm">Go to Quotations</Button></Link>
              )
            }
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="orders" />
        {/* Phones: the same guidance, under the list instead of beside the title. */}
        <p className="mn-ord-how mn-ord-how--foot">
          No “new order” button: raise one from <Link href="/app/sales/quotations">Sales → Quotations</Link> (Convert → Order draft) or a{' '}
          <Link href="/app/sales/rate-contracts">rate contract</Link>.
        </p>
      </Card>
    </div>
  );
}
