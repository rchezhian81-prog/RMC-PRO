'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardList, Lock, RefreshCw, ShieldAlert, Users, XCircle } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../lib/format-date';
import { money, moneyShort } from '../../../lib/money';
import { useListWindow } from '../../../lib/list-window';
import { ListCap } from '../../../components/ListCap';
import { creditHoldsApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

/**
 * Credit holds — orders stopped at the customer's credit limit.
 *
 * A status strip (waiting / released / refused) with live counts doubles as
 * the filter, a summary pill totals the value waiting, a note counts the
 * requests waiting for a decision, and each request is one row: the order
 * (linked) with its date and who confirmed it, the customer with their
 * terms, the order value that tripped the limit, the credit picture (what
 * was already owed, the limit, and how far over it the order would go, as a
 * meter), the decision with who made it and their note, and Release /
 * Refuse while it waits. Same layout in both skins; every colour reads the
 * semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'pending', label: 'Waiting', tone: 'warning', hint: 'The order is stopped until an approver decides' },
  { key: 'approved', label: 'Released', tone: 'success', hint: 'Credit was extended and the order confirmed' },
  { key: 'rejected', label: 'Refused', tone: 'danger', hint: 'The order went back to draft; collect first or cut it down' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;

export default function CreditHoldsPage() {
  const { prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    setRows(await creditHoldsApi.list(undefined, win.limit));
  }, [win.limit]);

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

  async function decide(r: Row, approve: boolean) {
    setError(null);
    setMsg(null);
    const over = num(r.exposureAfter) - num(r.creditLimit);
    const note = await prompt({
      title: approve ? `Release ${String(r.orderNo)}` : `Refuse ${String(r.orderNo)}`,
      message: approve
        ? `${String(r.customerName ?? 'The customer')} would owe ${money(r.exposureAfter)} against a limit of ${money(r.creditLimit)}, ${money(over)} over. Releasing confirms the order at that exposure; it goes to the plant and the outstanding stays with collections.`
        : `The order goes back to draft and nothing is booked. ${String(r.customerName ?? 'The customer')} already owes ${money(r.outstandingBefore)}; say what should happen (collect the August invoices, cut the order to 100 m³, and so on) so sales can act on it.`,
      label: approve ? 'Note (optional)' : 'Why it is refused',
      defaultValue: '',
      confirmLabel: approve ? 'Release and confirm' : 'Refuse',
    });
    if (note === null) return;
    if (!approve && !note.trim()) {
      setError('Give the reason it is refused; sales sees it on the draft.');
      return;
    }
    setBusy(true);
    try {
      if (approve) await creditHoldsApi.approve(String(r.id), note);
      else await creditHoldsApi.reject(String(r.id), note);
      await reload();
      setMsg(approve
        ? `${String(r.orderNo)} released and confirmed at ${money(r.exposureAfter)} exposure.`
        : `${String(r.orderNo)} refused; the order is back in drafts with your note.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const shown = filter ? rows.filter((r) => String(r.status) === filter) : rows;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.status), (m.get(String(r.status)) ?? 0) + 1);
    return m;
  }, [rows]);
  const waiting = rows.filter((r) => String(r.status) === 'pending');
  const waitingValue = waiting.reduce((t, r) => t + num(r.requestedAmount), 0);

  return (
    <div className="mn-ord mn-ch">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Credit holds</h1>
          <p>Orders that would take a customer past their credit limit. Nothing is booked until an approver decides: releasing confirms the order at the higher exposure; refusing sends it back to sales as a draft with the reason.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Lock size={14} aria-hidden />
            {loaded ? `${waiting.length} waiting${waiting.length ? ` · ${moneyShort(waitingValue)}` : ''}` : 'Loading…'}
          </span>
          <Link href="/app/entity/customers" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<Users size={14} />}>Customers</Button>
          </Link>
          <Link href="/app/orders" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ClipboardList size={14} />}>Orders</Button>
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

      {waiting.length > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('pending')}>
            <ShieldAlert size={16} aria-hidden />
            <span><strong>{waiting.length} {waiting.length === 1 ? 'order is' : 'orders are'} waiting on a credit decision, {moneyShort(waitingValue)} in all.</strong> Each one holds up a pour the customer is expecting; release it or refuse it with a reason.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card
        title={<span className="mn-board-card-title"><Lock size={16} aria-hidden /> Requests <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Raised when an order is confirmed for a customer over the limit.</span>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : shown.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Order</span>
              <span>Customer</span>
              <span className="is-num">Order value</span>
              <span>Credit picture</span>
              <span>Decision</span>
              <span />
            </div>
            {shown.map((r) => {
              const status = String(r.status ?? '');
              const limit = num(r.creditLimit);
              const before = num(r.outstandingBefore);
              const after = num(r.exposureAfter);
              const over = after - limit;
              const pctBefore = limit > 0 ? Math.min(100, (before / limit) * 100) : 0;
              const pctAfter = limit > 0 ? Math.min(100, (after / limit) * 100) : 100;
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts mn-ch-row${status === 'rejected' ? ' is-void' : ''}`} data-tone={toneOf(status)}>
                  <div className="mn-ord-id">
                    <Link href={`/app/orders/${String(r.orderId)}`} className="mn-ord-no">{String(r.orderNo ?? '—')}</Link>
                    <span className="mn-ord-meta">{r.orderDate ? formatDate(r.orderDate) : formatDate(r.createdAt)}{r.requestedByName ? <><span className="mn-ord-dot" aria-hidden>·</span>confirmed by {String(r.requestedByName)}</> : null}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">{num(r.creditDays) > 0 ? `${num(r.creditDays)} days credit` : 'Cash terms'} · limit {moneyShort(limit)}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.requestedAmount)}</span>
                    <span className="mn-ord-meta">with GST{num(r.orderValue) > 0 && num(r.orderValue) !== num(r.requestedAmount) ? ` · ${money(r.orderValue)} ex-GST` : ''}</span>
                  </div>
                  <div className="mn-ch-credit">
                    <span className="mn-cu-bar mn-ch-bar" role="img" aria-label={`${Math.round(pctAfter)}% of the credit limit after this order`}>
                      <span className="mn-ch-bar-before" style={{ width: `${pctBefore}%` }} />
                      <span className="mn-ch-bar-after" style={{ width: `${pctAfter}%` }} />
                    </span>
                    <span className="mn-ord-meta mn-ch-credit-text">
                      Owes <strong>{moneyShort(before)}</strong> · with this order <strong>{moneyShort(after)}</strong>
                      <span className="mn-ord-dot" aria-hidden>·</span>
                      <span className="mn-ch-over">{over > 0 ? `${moneyShort(over)} over the limit` : 'within the limit'}</span>
                    </span>
                  </div>
                  <div className="mn-ord-status mn-ch-decision">
                    <StatusBadge status={status} />
                    {status !== 'pending' ? (
                      <span className="mn-ord-meta mn-ch-decided">{String(r.decidedByName ?? 'Approver')}{r.decidedAt ? ` · ${formatDateTime(r.decidedAt)}` : ''}{r.decisionNote ? ` · ${String(r.decisionNote)}` : ''}</span>
                    ) : String(r.orderStatus) !== 'credit_hold' ? (
                      <span className="mn-ord-meta mn-ch-decided">Order is {String(r.orderStatus ?? '').replace(/_/g, ' ')} now; cannot be decided</span>
                    ) : null}
                  </div>
                  <div className="mn-ord-act mn-ch-acts">
                    {status === 'pending' && String(r.orderStatus) === 'credit_hold' && (
                      <>
                        <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => decide(r, true)} disabled={busy}>Release</Button>
                        <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => decide(r, false)} disabled={busy}>Refuse</Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : filter ? (
          <EmptyState title={`No ${labelOf(filter)} requests`} description="Press the chip again to show every request." />
        ) : (
          <EmptyState title="Nothing on hold" description="A request appears here when an order is confirmed for a customer who is over their credit limit. Until then, every confirmed order was within its limit." />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="requests" />
      </Card>
    </div>
  );
}
