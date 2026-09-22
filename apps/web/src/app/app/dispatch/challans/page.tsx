'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight, Download, FileText, Receipt, RefreshCw, RotateCcw, Truck } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { money } from '../../../../lib/money';
import { ListCap } from '../../../../components/ListCap';
import { challansApi, type Row, openPdf } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Delivery challans — every load that left the plant, as one row each.
 *
 * A status strip (draft / on the road / delivered / cancelled) with live
 * counts doubles as the filter, a summary pill totals the concrete on screen,
 * and each challan is one row: number and time out, who it went to and on
 * which truck, the quantity with the grade under it, where it stands with
 * Billing, the status, and a Print button. Delivered loads still waiting for
 * an invoice, and concrete that came back, get a note above the list. The
 * returned-concrete breakdown keeps its own card underneath. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'neutral', hint: 'Raised from a dispatch, not yet handed to the driver' },
  { key: 'issued', label: 'On the road', tone: 'info', hint: 'Issued to the driver; the load is on its way' },
  { key: 'delivered', label: 'Delivered', tone: 'success', hint: 'Signed for on site; ready to invoice' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn; the load was rejected or the trip cancelled' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;

/** Where the challan stands with Billing, as the fourth column reads it. */
function billing(r: Row): { label: string; note: string; tone: Tone } {
  const status = String(r.challanStatus ?? '');
  const returned = num(r.returnQuantityM3);
  if (status === 'cancelled') return { label: 'Nothing to bill', note: 'Cancelled', tone: 'neutral' };
  if (status === 'delivered') {
    const invoiced = String(r.invoiceStatus ?? '') === 'invoiced';
    const note = returned > 0
      ? `${qty(returned)} m³ returned`
      : r.receiverName ? `Received by ${String(r.receiverName)}` : 'Signed for on site';
    return invoiced
      ? { label: 'Invoiced', note, tone: returned > 0 ? 'warning' : 'success' }
      : { label: 'To invoice', note, tone: 'warning' };
  }
  if (status === 'issued') return { label: 'After delivery', note: 'On the road', tone: 'neutral' };
  return { label: 'After delivery', note: 'Not issued yet', tone: 'neutral' };
}

interface WastageBucket { key: string; label: string; quantityM3: number; cost: number; share: number }

export default function ChallansPage() {
  // `all` is the newest window of every status: it feeds the counts on the
  // strip and is what shows when no chip is pressed. Pressing a chip asks the
  // API for that status alone, so an old cancelled challan is still reachable
  // even when the unfiltered window is full of newer ones.
  const [all, setAll] = useState<Row[]>([]);
  const [filtered, setFiltered] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [wastage, setWastage] = useState<Row | null>(null);
  const [wastageBusy, setWastageBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [everything, some] = await Promise.all([
      challansApi.list(undefined, win.limit),
      filter ? challansApi.list(filter, win.limit) : Promise.resolve<Row[]>([]),
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

  async function loadWastage() {
    setWastageBusy(true);
    setError(null);
    try { setWastage(await challansApi.wastageReport()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setWastageBusy(false); }
  }

  const rows = filter ? filtered : all;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) m.set(String(r.challanStatus), (m.get(String(r.challanStatus)) ?? 0) + 1);
    return m;
  }, [all]);
  const totalM3 = useMemo(
    () => rows.reduce((t, r) => (String(r.challanStatus) === 'cancelled' ? t : t + num(r.quantityM3)), 0),
    [rows],
  );
  const toBill = useMemo(
    () => all.filter((r) => String(r.challanStatus) === 'delivered' && String(r.invoiceStatus ?? '') !== 'invoiced').length,
    [all],
  );
  const returned = useMemo(() => {
    const loads = all.filter((r) => String(r.challanStatus) === 'delivered' && num(r.returnQuantityM3) > 0);
    return { loads: loads.length, m3: loads.reduce((t, r) => t + num(r.returnQuantityM3), 0) };
  }, [all]);
  const byReason = (wastage?.byReason as WastageBucket[] | undefined) ?? null;

  return (
    <div className="mn-ord mn-dc">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Delivery challans</h1>
          <p>Every load that leaves the plant travels on a challan: raised from a dispatch, issued to the driver, signed for on site. Delivered challans are what Billing turns into invoices.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Truck size={14} aria-hidden />
            {rows.length} {filter ? labelOf(filter) : ''} {rows.length === 1 ? 'challan' : 'challans'}
            {' · '}
            {qty(totalM3)} m³
          </span>
          <Link href="/app/dispatch/delivery-register" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<BookOpen size={14} />}>Delivery register</Button>
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

      {(toBill > 0 || returned.loads > 0) && !filter && (
        <div className="mn-ord-notes">
          {toBill > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <Receipt size={16} aria-hidden />
              <span>
                <strong>{toBill} delivered {toBill === 1 ? 'challan is' : 'challans are'} not invoiced yet.</strong>{' '}
                Raise the invoice from <Link href="/app/billing/invoices">Billing → Invoices</Link> (From challans).
              </span>
            </div>
          )}
          {returned.loads > 0 && (
            <a className="mn-ord-note mn-ord-note--bad" href="#wastage">
              <RotateCcw size={16} aria-hidden />
              <span>
                <strong>{qty(returned.m3)} m³ came back on {returned.loads} {returned.loads === 1 ? 'load' : 'loads'}.</strong>{' '}
                See the returned-concrete breakdown below.
              </span>
            </a>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Challans <span className="mn-board-card-count">{rows.length}</span></span>}
        actions={
          <span className="mn-ord-how">
            No “new challan” button: raise one from a load on the{' '}
            <Link href="/app/dispatch/board">Dispatch board</Link> (Challan), then issue and deliver it from the challan itself.
          </span>
        }
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : rows.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Challan</span>
              <span>Customer · truck</span>
              <span className="is-num">Quantity</span>
              <span>Billing</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map((r) => {
              const status = String(r.challanStatus ?? '');
              const b = billing(r);
              const no = String(r.challanNo ?? '');
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts${status === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(status)} role="listitem">
                  <div className="mn-ord-id">
                    <Link href={`/app/dispatch/challans/${r.id}`} className="mn-ord-no mn-ord-stretch">{no}</Link>
                    <span className="mn-ord-meta">{formatDateTime(r.dispatchTime ?? r.createdAt)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">
                      {String(r.siteName ?? 'No site')}
                      {r.vehicleNo ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.vehicleNo)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{qty(r.quantityM3)} m³</span>
                    <span className="mn-ord-meta">
                      {String(r.gradeLabel ?? 'No grade')}
                      {r.slump ? <><span className="mn-ord-dot" aria-hidden>·</span>Slump {String(r.slump)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-when" data-tone={b.tone}>
                    <span className="mn-ord-when-d">{b.label}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{b.note}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={status} /></div>
                  <div className="mn-ord-go">
                    <span className="mn-ord-act">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Download size={14} />}
                        aria-label={`Print ${no}`}
                        onClick={() => openPdf(`/delivery-challans/${String(r.id)}/pdf`, String(r.challanNo ?? '')).catch((e) => setError(String(e)))}
                      >
                        Print
                      </Button>
                    </span>
                    <ChevronRight size={18} aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} challans` : 'No challans yet'}
            description={filter ? 'Nothing in this status right now. Press the chip again to see every challan.' : 'A challan is raised from a load on the Dispatch board. Once a truck is dispatched, press Challan on its card.'}
            action={
              filter ? (
                <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all challans</Button>
              ) : (
                <Link href="/app/dispatch/board"><Button size="sm">Go to Dispatch board</Button></Link>
              )
            }
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="challans" hint="the delivery register (Dispatch)" />
        {/* Phones: the same guidance, under the list instead of beside the title. */}
        <p className="mn-ord-how mn-ord-how--foot">
          No “new challan” button: raise one from a load on the <Link href="/app/dispatch/board">Dispatch board</Link> (Challan), then issue and deliver it from the challan itself.
        </p>
      </Card>

      <div id="wastage">
        <Card
          title={<span className="mn-board-card-title"><RotateCcw size={16} aria-hidden /> Returned concrete</span>}
          actions={
            <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={loadWastage} loading={wastageBusy}>
              {wastage ? 'Refresh' : 'Summarise'}
            </Button>
          }
          padded={false}
        >
          {wastage ? (
            byReason && byReason.length ? (
              <div>
                <div className="mn-dc-wsum">
                  <span><strong>{qty(wastage.totalReturnedM3)} m³</strong> returned on delivered loads</span>
                  <span><strong>{money(wastage.totalReturnCost)}</strong> written off</span>
                </div>
                <Table>
                  <thead><tr><Th>Reason</Th><Th numeric>Returned m³</Th><Th numeric>Value</Th><Th numeric>Share</Th></tr></thead>
                  <tbody>
                    {byReason.map((b) => (
                      <tr key={b.key}><Td>{b.label}</Td><Td numeric>{qty(b.quantityM3)}</Td><Td numeric>{money(b.cost)}</Td><Td numeric>{b.share}%</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <EmptyState title="Nothing came back" description="No returned concrete has been recorded on a delivered challan." />
            )
          ) : (
            <EmptyState title="Returned concrete, by reason" description="Press Summarise to total the concrete that came back from site, with its cost, grouped by the reason recorded at delivery." />
          )}
        </Card>
      </div>
    </div>
  );
}
