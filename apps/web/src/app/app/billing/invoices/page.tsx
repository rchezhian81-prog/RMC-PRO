'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, BookOpen, ChevronRight, Download, FileText, PenLine, Plus, Receipt, RefreshCw } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { todayLocal } from '../../../../lib/report-range';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, invoicesApi, type Row, openPdf } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Invoices — the sales ledger at a glance.
 *
 * A stage strip (draft / awaiting payment / overdue / paid / cancelled) with
 * live counts doubles as the filter, a summary pill totals what is still owed
 * on screen, and each invoice is one row: number and date, who it bills, the
 * total with the taxable figure under it, what is outstanding and when it is
 * due, the status (with e-invoice and e-way marks once they exist), and Print.
 * Overdue money and unissued drafts get a note above the list. The "new
 * invoice from delivered challans" form keeps its place above the list. Same
 * layout in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'neutral', hint: 'Created from challans, not yet issued; carries no number until it is' },
  { key: 'due', label: 'Awaiting payment', tone: 'info', hint: 'Issued, money still owed, due date not passed' },
  { key: 'overdue', label: 'Overdue', tone: 'danger', hint: 'Issued, money still owed, due date passed' },
  { key: 'paid', label: 'Settled', tone: 'success', hint: 'Nothing left to collect: paid, credited or written off' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn; its challans are billable again' },
];
const toneOf = (stage: string): Tone => STAGES.find((s) => s.key === stage)?.tone ?? 'neutral';
const labelOf = (stage: string) => STAGES.find((s) => s.key === stage)?.label.toLowerCase() ?? stage;

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
const dueIn = (r: Row): number | null => (r.dueDate ? daysUntil(String(r.dueDate).slice(0, 10)) : null);
const settled = (r: Row) => ['paid', 'credited', 'written_off'].includes(String(r.paymentStatus ?? ''));

/** Which chip an invoice sits under right now. */
function stageOf(r: Row): string {
  const status = String(r.invoiceStatus ?? 'draft');
  if (status === 'draft' || status === 'cancelled') return status;
  if (settled(r) || num(r.outstandingAmount) <= 0.001) return 'paid';
  const days = dueIn(r);
  return days != null && days < 0 ? 'overdue' : 'due';
}

/** What the money column says: how much is still owed, and when it is due. */
function payment(r: Row): { label: string; note: string; tone: Tone } {
  const stage = stageOf(r);
  const owed = num(r.outstandingAmount);
  if (stage === 'draft') return { label: 'Not issued', note: 'Issue it to number it', tone: 'neutral' };
  if (stage === 'cancelled') return { label: 'Nothing due', note: 'Cancelled', tone: 'neutral' };
  if (stage === 'paid') {
    const ps = String(r.paymentStatus ?? '');
    return { label: 'Settled', note: ps === 'credited' ? 'Cleared by credit note' : ps === 'written_off' ? 'Written off' : 'Paid in full', tone: 'success' };
  }
  const days = dueIn(r);
  const part = num(r.amountPaid) > 0.001 ? 'Part paid · ' : '';
  if (days == null) return { label: `${money(owed)} due`, note: `${part}No due date`, tone: 'warning' };
  if (days < 0) return { label: `${money(owed)} overdue`, note: `${part}${-days === 1 ? '1 day' : `${-days} days`} past due`, tone: 'danger' };
  if (days === 0) return { label: `${money(owed)} due`, note: `${part}Due today`, tone: 'warning' };
  return { label: `${money(owed)} due`, note: `${part}Due ${formatDate(r.dueDate)}`, tone: days <= 3 ? 'warning' : 'neutral' };
}

interface LineForm { challanId: string; challanNo: string; quantity: number; hsnSac: string; uom: string; rate: string; gstRate: string; }

export default function InvoicesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineForm[]>([]);
  const [invoiceDate, setInvoiceDate] = useState(todayLocal);
  const [dueDate, setDueDate] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [inv, c] = await Promise.all([invoicesApi.list(undefined, win.limit), crud('customers').list()]);
    setRows(inv);
    setCustomers(c);
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

  async function loadBillable(cid: string) {
    setCustomerId(cid);
    setLines([]);
    setError(null);
    if (!cid) return;
    try {
      const challans = await invoicesApi.billableChallans(cid);
      setLines(
        challans.map((c) => ({
          // Preview the quantity that will actually be billed under the order's
          // return policy (net of returns unless the order bills gross).
          challanId: String(c.id), challanNo: String(c.challanNo), quantity: Number(c.billedQuantityM3 ?? c.quantityM3),
          hsnSac: '68109990', uom: 'm3',
          // Pre-fill the rate agreed on the order so the clerk confirms rather
          // than re-types it. 0 (no order line found) leaves it blank to fill in.
          rate: Number(c.suggestedRate) > 0 ? String(c.suggestedRate) : '',
          gstRate: '18',
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  function setLine(i: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    setError(null);
    const use = lines.filter((l) => Number(l.rate) > 0);
    if (!customerId || !use.length) {
      setError('Pick a customer and set a rate on at least one challan');
      return;
    }
    setCreating(true);
    try {
      const inv = await invoicesApi.fromChallans({
        customerId,
        invoiceDate: invoiceDate || undefined,
        dueDate: dueDate || undefined,
        lines: use.map((l) => ({ challanId: l.challanId, hsnSac: l.hsnSac, uom: l.uom, rate: Number(l.rate), gstRate: Number(l.gstRate) })),
      });
      router.push(`/app/billing/invoices/${inv.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setCreating(false);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (filter ? rows.filter((r) => stageOf(r) === filter) : rows), [rows, filter]);
  const owed = useMemo(
    () => shown.reduce((t, r) => (['due', 'overdue'].includes(stageOf(r)) ? t + num(r.outstandingAmount) : t), 0),
    [shown],
  );
  const overdue = useMemo(() => {
    const list = rows.filter((r) => stageOf(r) === 'overdue');
    return { count: list.length, amount: list.reduce((t, r) => t + num(r.outstandingAmount), 0) };
  }, [rows]);
  const drafts = counts.get('draft') ?? 0;
  const lineTotal = useMemo(() => lines.reduce((t, l) => t + l.quantity * num(l.rate), 0), [lines]);

  return (
    <div className="mn-ord mn-inv">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Invoices</h1>
          <p>A GST tax invoice is raised from delivered challans, then issued to take its number. Issuing locks it; receipts settle it; a credit note corrects it.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Receipt size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'invoice' : 'invoices'}
            {' · '}
            {moneyShort(owed)} owed
          </span>
          <Link href="/app/billing/reports" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<BookOpen size={14} />}>Sales register</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Stage strip — counts per stage; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by stage">
        {STAGES.map((s) => {
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

      {(overdue.count > 0 || drafts > 0) && !filter && (
        <div className="mn-ord-notes">
          {overdue.count > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter('overdue')}>
              <AlertTriangle size={16} aria-hidden />
              <span>
                <strong>{money(overdue.amount)} is past due on {overdue.count} {overdue.count === 1 ? 'invoice' : 'invoices'}.</strong>{' '}
                Press to see them; record what comes in under Billing → Receipts.
              </span>
            </button>
          )}
          {drafts > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('draft')}>
              <PenLine size={16} aria-hidden />
              <span>
                <strong>{drafts} {drafts === 1 ? 'draft is' : 'drafts are'} waiting to be issued.</strong>{' '}
                A draft has no number and no GST liability until you issue it. Press to see them.
              </span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New invoice from delivered challans</span>}>
        <div className="mn-inv-form">
          <Field label="Customer">
            <select className="mn-input" value={customerId} onChange={(e) => loadBillable(e.target.value)}>
              <option value="">— select —</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>
              ))}
            </select>
          </Field>
          <Field label="Invoice date">
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        {customerId ? (
          lines.length ? (
            <div className="mn-inv-lines">
              <Table>
                <thead>
                  <tr>
                    <Th>Challan</Th>
                    <Th numeric>Qty m³</Th>
                    <Th>HSN/SAC</Th>
                    <Th>UOM</Th>
                    <Th numeric>Rate</Th>
                    <Th numeric>GST%</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.challanId}>
                      <Td style={{ fontWeight: 600 }}>{l.challanNo}</Td>
                      <Td numeric>{qty(l.quantity)}</Td>
                      <Td><Input style={{ width: 110 }} value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} /></Td>
                      <Td><Input style={{ width: 64 }} value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })} /></Td>
                      <Td numeric><Input type="number" step="any" style={{ width: 96, textAlign: 'right' }} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></Td>
                      <Td numeric><Input type="number" step="any" style={{ width: 74, textAlign: 'right' }} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mn-inv-submit">
                <span className="mn-inv-submit-sum">
                  {lines.length} {lines.length === 1 ? 'challan' : 'challans'} · <strong>{money(lineTotal)}</strong> before GST
                </span>
                <Button onClick={create} loading={creating}>Create draft invoice</Button>
              </div>
            </div>
          ) : (
            <p className="mn-board-form-hint">No delivered, un-invoiced challans for this customer. Deliver a load first, or pick another customer.</p>
          )
        ) : (
          <p className="mn-board-form-hint">Pick a customer to list their delivered, un-invoiced challans. The rate agreed on the order is filled in for you; leave a rate empty to leave that challan out.</p>
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Sales ledger <span className="mn-board-card-count">{shown.length}</span></span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Invoice</span>
              <span>Customer</span>
              <span className="is-num">Total</span>
              <span>Payment</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const p = payment(r);
              const no = r.invoiceNo ? String(r.invoiceNo) : 'Draft';
              const gst = num(r.cgstAmount) + num(r.sgstAmount) + num(r.igstAmount) + num(r.cessAmount);
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts${stage === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <Link href={`/app/billing/invoices/${r.id}`} className={`mn-ord-no mn-ord-stretch${r.invoiceNo ? '' : ' mn-inv-draft'}`}>{no}</Link>
                    <span className="mn-ord-meta">
                      {formatDate(r.invoiceDate ?? r.createdAt)}
                      {r.isInterstate ? <><span className="mn-ord-dot" aria-hidden>·</span>IGST</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">
                      {String(r.siteName ?? 'No site')}
                      {r.gstin ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.gstin)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.totalAmount)}</span>
                    <span className="mn-ord-meta">{money(r.taxableAmount)} + {money(gst)} GST</span>
                  </div>
                  <div className="mn-ord-when" data-tone={p.tone}>
                    <span className="mn-ord-when-d">{p.label}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{p.note}</span>
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={String(r.invoiceStatus ?? 'draft')} />
                    {String(r.einvoiceStatus) === 'generated' && <Badge tone="success">e-invoice</Badge>}
                    {String(r.ewayStatus) === 'generated' && <Badge tone="info">e-way</Badge>}
                  </div>
                  <div className="mn-ord-go">
                    <span className="mn-ord-act">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Download size={14} />}
                        aria-label={`Print ${no}`}
                        onClick={() => openPdf(`/invoices/${String(r.id)}/pdf`, String(r.invoiceNo ?? 'Draft invoice')).catch((e) => setError(String(e)))}
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
            title={filter ? `No ${labelOf(filter)} invoices` : 'No invoices yet'}
            description={filter ? 'Nothing at this stage right now. Press the chip again to see every invoice.' : 'Pick a customer above to bill their delivered challans. The first invoice appears here as a draft.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all invoices</Button> : undefined}
          />
        )}
        <ListCap shown={shown.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="invoices" hint="the sales register (Billing → Reports)" />
      </Card>
    </div>
  );
}
