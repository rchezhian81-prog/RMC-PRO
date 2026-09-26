'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, Package, PackageMinus, RefreshCw, SlidersHorizontal, XCircle } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { negativeStockApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Negative stock approvals — decreases the books cannot cover.
 *
 * A status strip (waiting / approved / rejected) with live counts doubles as
 * the filter, a summary pill counts the requests on screen, and each request
 * is one row: the material with its plant, what was asked against what the
 * books had (and how far below zero it goes), the reason with who asked and
 * when, the decision with who made it and their remarks, and Approve /
 * Reject while it waits. A note counts the requests waiting for a decision.
 * Same layout in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'pending', label: 'Waiting', tone: 'warning', hint: 'Nothing has moved; the decrease posts only if approved' },
  { key: 'approved', label: 'Approved', tone: 'success', hint: 'The decrease was posted and the balance went below zero' },
  { key: 'rejected', label: 'Rejected', tone: 'danger', hint: 'Left as it was; the books were not changed' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;
const sourceOf = (r: Row) => (String(r.referenceType ?? '') === 'batch_ticket' ? 'from batching' : 'from a stock adjustment');

export default function NegativeStockPage() {
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
    setRows(await negativeStockApi.list(undefined, win.limit));
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
    const unit = String(r.uom ?? '');
    const remarks = await prompt({
      title: approve ? 'Approve the decrease' : 'Reject the decrease',
      message: approve
        ? `${qty(r.requiredQuantity)} ${unit} of ${String(r.materialLabel ?? 'material')} is taken out against ${qty(r.availableQuantity)} ${unit} on the books, leaving −${qty(r.negativeQuantity)} ${unit}. Approve when the material really was used or lost and the books are what is wrong; book the missing inward afterwards to bring the balance back.`
        : `${String(r.materialLabel ?? 'The material')} stays at ${qty(r.availableQuantity)} ${unit}; nothing is posted. Say what should happen instead (book the delivery first, recount, and so on).`,
      label: approve ? 'Remarks (optional)' : 'Why it is rejected',
      defaultValue: '',
      confirmLabel: approve ? 'Approve' : 'Reject',
    });
    if (remarks === null) return;
    setBusy(true);
    try {
      if (approve) await negativeStockApi.approve(String(r.id), remarks);
      else await negativeStockApi.reject(String(r.id), remarks);
      await reload();
      setMsg(approve
        ? `${String(r.materialLabel ?? 'Material')}: ${qty(r.requiredQuantity)} ${unit} posted; the balance is now below zero until the missing inward is booked.`
        : `${String(r.materialLabel ?? 'Material')}: request rejected; stock is unchanged.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const shown = filter ? rows.filter((r) => String(r.approvalStatus) === filter) : rows;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.approvalStatus), (m.get(String(r.approvalStatus)) ?? 0) + 1);
    return m;
  }, [rows]);
  const waiting = counts.get('pending') ?? 0;

  return (
    <div className="mn-ord mn-ns">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Negative stock approvals</h1>
          <p>Decreases that would take a material below what the books say is there. Nothing moves until an approver decides: approving posts the issue and lets the balance go below zero so the books can be reconciled afterwards; rejecting leaves stock as it is.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <PackageMinus size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'request' : 'requests'}
          </span>
          <Link href="/app/inventory/adjustments" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={14} />}>Stock adjustments</Button>
          </Link>
          <Link href="/app/production/stock" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Package size={14} />}>Stock</Button>
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

      {waiting > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('pending')}>
            <ClipboardCheck size={16} aria-hidden />
            <span><strong>{waiting} {waiting === 1 ? 'request is' : 'requests are'} waiting for a decision.</strong> Each one holds up a correction the yard has already counted; approve it or say what should happen instead.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card
        title={<span className="mn-board-card-title"><PackageMinus size={16} aria-hidden /> Requests <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">A request is raised by a decrease under Stock adjustments that the books cannot cover.</span>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : shown.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Material</span>
              <span className="is-num">Asked</span>
              <span className="is-num">On the books</span>
              <span>Reason</span>
              <span>Decision</span>
              <span />
            </div>
            {shown.map((r) => {
              const status = String(r.approvalStatus ?? '');
              const unit = String(r.uom ?? '');
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts mn-ns-row${status === 'rejected' ? ' is-void' : ''}`} data-tone={toneOf(status)}>
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.materialLabel ?? '—')}</span>
                    <span className="mn-ord-meta">{String(r.materialCode ?? '')}{r.plantName ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.plantName)}</> : null}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt mn-st-out">−{qty(r.requiredQuantity)} {unit}</span>
                    <span className="mn-ord-meta mn-ns-neg">leaves −{qty(r.negativeQuantity)} {unit}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{qty(r.availableQuantity)} {unit}</span>
                    <span className="mn-ord-meta">{r.currentQuantity != null && num(r.currentQuantity) !== num(r.availableQuantity) ? `now ${qty(r.currentQuantity)} ${unit}` : 'when it was asked'}</span>
                  </div>
                  <div className="mn-ns-reason">
                    <span className="mn-ns-reason-text">{r.requestReason ? String(r.requestReason) : 'No reason given'}</span>
                    <span className="mn-ord-meta">{String(r.requestedByName ?? 'Someone')} · {formatDateTime(r.createdAt)} · {sourceOf(r)}</span>
                  </div>
                  <div className="mn-ord-status mn-ns-decision">
                    <StatusBadge status={status} />
                    {status !== 'pending' ? (
                      <span className="mn-ord-meta mn-ns-decided">{String(r.approvedByName ?? 'Approver')}{r.approvedAt ? ` · ${formatDateTime(r.approvedAt)}` : ''}{r.approvalRemarks ? ` · ${String(r.approvalRemarks)}` : ''}</span>
                    ) : null}
                  </div>
                  <div className="mn-ord-act mn-ns-acts">
                    {status === 'pending' && (
                      <>
                        <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => decide(r, true)} disabled={busy}>Approve</Button>
                        <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => decide(r, false)} disabled={busy}>Reject</Button>
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
          <EmptyState title="Nothing waiting" description="A request appears here when a decrease under Stock adjustments would take a material below zero. Until then, the books and the yard agree." />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="requests" />
      </Card>
    </div>
  );
}
