'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, ClipboardList, FilePlus, FileSignature, FileText, RefreshCw, ShieldAlert } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { orderDraftsApi, ordersApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Order drafts — the handoff from sales to operations.
 *
 * Every order still in draft, whether it came from an approved quotation, a
 * rate contract or was keyed in: a source strip (quotation / rate contract /
 * keyed in) with live counts doubles as the filter, a summary pill totals
 * the drafts on screen, a note counts the drafts sent back after a credit
 * refusal, and each draft is one row: number and date with the document it
 * was priced from, the customer and site, the lines (grades and m³), the
 * value with and without GST, its credit standing, and Confirm (which runs
 * the credit check) or Open. Same layout in both skins; every colour reads
 * the semantic tokens.
 */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const SOURCES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'quotation', label: 'From quotation', tone: 'info', hint: 'Converted from an approved quotation; carries its prices' },
  { key: 'rate_contract', label: 'From rate contract', tone: 'info', hint: 'Booked under a rate contract; carries its rates' },
  { key: 'manual', label: 'Keyed in', tone: 'neutral', hint: 'Entered directly, prices typed by hand' },
];
const sourceOf = (r: Row) => (String(r.pricingSource ?? '') === 'quotation' || String(r.pricingSource ?? '') === 'rate_contract' ? String(r.pricingSource) : 'manual');
const labelOf = (key: string) => SOURCES.find((s) => s.key === key)?.label.toLowerCase() ?? key;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

/** What the credit column says about a draft. */
function credit(r: Row): { label: string; tone: Tone; note: string } {
  const st = String(r.creditStatus ?? 'not_checked');
  if (st === 'rejected') return { label: 'Credit refused', tone: 'danger', note: r.lastCreditNote ? String(r.lastCreditNote) : 'Sent back to draft; collect first or revise the order' };
  if (st === 'approved') return { label: 'Credit cleared', tone: 'success', note: 'Confirm to book it' };
  if (String(r.pricingType) === 'cash') return { label: 'Cash order', tone: 'neutral', note: 'No credit check; confirm to book it' };
  return { label: 'Not checked yet', tone: 'neutral', note: 'Confirm runs the credit check' };
}

export default function OrderDraftsPage() {
  const { confirm: ask } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await orderDraftsApi.list());
  }, []);

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

  async function open(id: string) {
    setError(null);
    if (sel?.id === id) {
      setSel(null);
      return;
    }
    setSel(await orderDraftsApi.get(id));
  }

  async function confirmOrder(r: Row) {
    const c = credit(r);
    const ok = await ask({
      title: `Confirm ${String(r.orderNo)}`,
      message: c.tone === 'danger'
        ? `Credit was refused on this order before (${c.note}). Confirming runs the check again: if the customer is still over the limit it goes back on credit hold for an approver.`
        : `${money(r.estimatedOrderValueInclGst ?? r.estimatedOrderValue)} for ${String(r.customerName ?? 'the customer')}. Confirming books it for production and dispatch after the credit check; if the customer is over their limit it waits on credit hold for an approver.`,
      confirmLabel: 'Confirm order',
    });
    if (!ok) return;
    setBusy(String(r.id));
    setError(null);
    setMsg(null);
    try {
      const out = await ordersApi.confirm(String(r.id));
      await reload();
      if (sel?.id === r.id) setSel(null);
      const st = String(out?.orderStatus ?? '');
      setMsg(st === 'credit_hold'
        ? `${String(r.orderNo)} is on credit hold: the customer is over the limit, so an approver decides under Credit holds.`
        : `${String(r.orderNo)} confirmed. It is now under Orders, ready for the plan and dispatch.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(sourceOf(r), (m.get(sourceOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (filter ? rows.filter((r) => sourceOf(r) === filter) : rows), [rows, filter]);
  const totalValue = useMemo(() => shown.reduce((t, r) => t + num(r.estimatedOrderValue), 0), [shown]);
  const refused = rows.filter((r) => String(r.creditStatus) === 'rejected').length;
  const items = (sel?.items as Row[]) ?? [];

  return (
    <div className="mn-ord mn-odr">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Order drafts</h1>
          <p>Orders written up but not yet booked. Each one came from an approved quotation or a rate contract, or was keyed in. Confirm runs the credit check and hands the order to the plant; anything over the customer&rsquo;s limit waits for an approver instead.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <FilePlus size={14} aria-hidden />
            {loaded ? `${shown.length} ${filter ? labelOf(filter) : ''} ${shown.length === 1 ? 'draft' : 'drafts'} · ${moneyShort(totalValue)}` : 'Loading…'}
          </span>
          <Link href="/app/orders" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<ClipboardList size={14} />}>Orders</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Source strip — counts per source; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by source">
        {SOURCES.map((s) => {
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

      {loaded && refused > 0 && (
        <div className="mn-ord-notes">
          <div className="mn-ord-note mn-ord-note--bad">
            <ShieldAlert size={16} aria-hidden />
            <span><strong>{refused} {refused === 1 ? 'draft was' : 'drafts were'} sent back after credit was refused.</strong> Collect what is due or cut the order down, then confirm again; the reason the approver gave is on the row.</span>
          </div>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card
        title={<span className="mn-board-card-title"><FilePlus size={16} aria-hidden /> Drafts <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Press Lines to see the grades and rates; Open goes to the full order.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Draft</span>
              <span>Customer</span>
              <span>Lines</span>
              <span className="is-num">Value</span>
              <span>Credit</span>
              <span />
            </div>
            {shown.map((r) => {
              const c = credit(r);
              const on = sel?.id === r.id;
              const n = num(r.itemCount);
              const src = sourceOf(r);
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts mn-odr-row${on ? ' is-on' : ''}`} data-tone={c.tone === 'danger' ? 'danger' : 'info'} role="listitem">
                  <div className="mn-ord-id">
                    <Link href={`/app/orders/${String(r.id)}`} className="mn-ord-no">{String(r.orderNo ?? '')}</Link>
                    <span className="mn-ord-meta">
                      {formatDate(r.orderDate ?? r.createdAt)}
                      <span className="mn-ord-dot" aria-hidden>·</span>
                      {src === 'quotation' ? (r.quotationId ? <Link href={`/app/sales/quotations/${String(r.quotationId)}`} className="mn-id-link">{String(r.quotationNo ?? 'quotation')}</Link> : 'quotation')
                        : src === 'rate_contract' ? (r.rateContractId ? <Link href={`/app/sales/rate-contracts/${String(r.rateContractId)}`} className="mn-id-link">{String(r.rateContractNo ?? 'rate contract')}</Link> : 'rate contract')
                        : 'keyed in'}
                    </span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? 'Customer not set')}</span>
                    <span className="mn-ord-meta">{r.siteName ? String(r.siteName) : 'No site'}{r.plantName ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.plantName)}</> : null}</span>
                  </div>
                  <div className="mn-odr-lines">
                    <span className="mn-odr-grades">{n ? String(r.gradeLabels ?? '') : 'No lines yet'}</span>
                    <span className="mn-ord-meta">{n ? `${qty(r.quantityM3)} m³ · ${n} ${n === 1 ? 'line' : 'lines'}` : 'Open the order to add lines'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.estimatedOrderValue)}</span>
                    <span className="mn-ord-meta">{num(r.estimatedOrderValueInclGst) > 0 ? `${money(r.estimatedOrderValueInclGst)} with GST` : 'ex-GST'}</span>
                  </div>
                  <div className="mn-ord-when mn-odr-credit" data-tone={c.tone}>
                    <span className="mn-ord-when-d">{c.label}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{c.note}</span>
                  </div>
                  <div className="mn-ord-act mn-odr-acts">
                    <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => confirmOrder(r)} loading={busy === r.id} disabled={busy !== null || !n}>Confirm</Button>
                    <Button size="sm" variant={on ? 'secondary' : 'ghost'} onClick={() => open(String(r.id)).catch((e) => setError(String(e)))}>{on ? 'Hide lines' : 'Lines'}</Button>
                    <Link href={`/app/orders/${String(r.id)}`} className="mn-ord-link"><Button size="sm" variant="ghost" icon={<ChevronRight size={14} />}>Open</Button></Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No drafts ${labelOf(filter)}` : 'No order drafts'}
            description={filter ? 'Press the chip again to see every draft.' : 'A draft appears here when an approved quotation is converted, an order is booked under a rate contract, or one is keyed in under Orders. Confirmed orders are under Orders.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all drafts</Button> : <Link href="/app/sales/quotations" className="mn-ord-link"><Button variant="secondary" size="sm" icon={<FileText size={14} />}>Quotations</Button></Link>}
          />
        )}
      </Card>

      {sel && (
        <div className="mn-pp-ws">
          <Card
            title={<span className="mn-board-card-title"><ClipboardList size={16} aria-hidden /> {String(sel.orderNo)} <span className="mn-pp-sub">· {String(sel.customerName ?? '')} · lines</span> <StatusBadge status={String(sel.orderStatus ?? 'draft')} /></span>}
            actions={
              <div className="mn-pp-tools">
                {sel.rateContractId ? <Link href={`/app/sales/rate-contracts/${String(sel.rateContractId)}`} className="mn-ord-link"><Button size="sm" variant="ghost" icon={<FileSignature size={14} />}>Rate contract</Button></Link> : null}
                {sel.quotationId ? <Link href={`/app/sales/quotations/${String(sel.quotationId)}`} className="mn-ord-link"><Button size="sm" variant="ghost" icon={<FileText size={14} />}>Quotation</Button></Link> : null}
                <Link href={`/app/orders/${String(sel.id)}`} className="mn-ord-link"><Button size="sm" variant="secondary" icon={<ChevronRight size={14} />}>Open order</Button></Link>
                <Button size="sm" variant="ghost" onClick={() => setSel(null)}>Close</Button>
              </div>
            }
            padded={false}
          >
            <p className="mn-pp-hint">
              {sel.requiredDatetime ? `Wanted ${formatDateTime(sel.requiredDatetime)}. ` : ''}All amounts per m³; the line value is qty × (rate + transport + pump + waiting), before GST.{sel.specialInstructions ? ` Instructions: ${String(sel.specialInstructions)}` : ''}
            </p>
            <div className="mn-id-scroll">
              <table className="mn-table mn-odr-table">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th className="is-num">Qty m³</th>
                    <th className="is-num">Rate/m³</th>
                    <th className="is-num">All-in/m³</th>
                    <th className="is-num">GST</th>
                    <th className="is-num">Line value</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const allIn = num(it.ratePerM3) + num(it.transportCharge) + num(it.pumpCharge) + num(it.waitingCharge);
                    return (
                      <tr key={String(it.id)}>
                        <td><span className="mn-od-grade">{String(it.gradeLabel ?? '')}</span>{it.slumpRequired ? <span className="mn-od-rate-meta">slump {String(it.slumpRequired)}</span> : null}</td>
                        <td className="is-num mn-od-num">{qty(it.quantityM3)}</td>
                        <td className="is-num">
                          <span className="mn-od-num">{money(it.ratePerM3)}</span>
                          {allIn - num(it.ratePerM3) > 0 && <span className="mn-od-rate-meta">+ {[num(it.transportCharge) ? `transport ${money(it.transportCharge)}` : '', num(it.pumpCharge) ? `pump ${money(it.pumpCharge)}` : '', num(it.waitingCharge) ? `waiting ${money(it.waitingCharge)}` : ''].filter(Boolean).join(' · ')}</span>}
                        </td>
                        <td className="is-num mn-od-num">{money(allIn)}</td>
                        <td className="is-num">{num(it.gstRate)}%</td>
                        <td className="is-num mn-od-num">{money(num(it.quantityM3) * allIn)}</td>
                      </tr>
                    );
                  })}
                  {!items.length && (
                    <tr><td colSpan={6} className="mn-ord-meta">No lines yet. Open the order to add them.</td></tr>
                  )}
                </tbody>
                {items.length > 0 && (
                  <tfoot>
                    <tr className="mn-ir-total">
                      <td>Order</td>
                      <td className="is-num">{qty(items.reduce((t, it) => t + num(it.quantityM3), 0))}</td>
                      <td colSpan={3} className="is-num"><span className="mn-ord-meta">{num(sel.estimatedOrderValueInclGst) > 0 ? `${money(sel.estimatedOrderValueInclGst)} with GST` : ''}</span></td>
                      <td className="is-num"><span className="mn-ir-total-value">{money(sel.estimatedOrderValue)}</span></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="mn-odr-foot">
              <Badge tone={credit(sel).tone === 'danger' ? 'danger' : 'neutral'}>{credit(sel).label}</Badge>
              <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => confirmOrder(sel)} loading={busy === sel.id} disabled={busy !== null || !items.length}>Confirm {String(sel.orderNo)}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
