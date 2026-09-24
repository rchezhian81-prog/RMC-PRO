'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BarChart3, BookOpen, CalendarRange, Download, FileText, Landmark, Layers, Receipt, RefreshCw, Scale, TrendingDown, Wallet } from 'lucide-react';
import { currentMonthRange, financialYearRange, settledFailure, settledValue, settledReason, todayLocal } from '../../../../lib/report-range';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { billingReportsApi, downloadTallyCsv, type SalesRegister, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Billing reports — the period's sales, tax and money in, in one place.
 *
 * A period bar (this month, last month, this financial year, all time, or
 * any two dates) bounds every report. Five tiles sum the period up
 * (invoiced, taxable, GST payable, collected, collection efficiency); notes
 * call out cancelled invoice numbers, grades sold below their material
 * cost and slow payers. Then the reports, each a card: GST for the period
 * (invoices, notes, the net output tax, input credit and what is payable),
 * the HSN summary, the sales register with its B2B / B2C split, the credit
 * and debit notes, the receipts register, the cash and bank day book, the
 * margin per m³ by grade, and collection efficiency with DSO. Each card
 * checks its own settled slot first, so a refused report says so instead
 * of "No …". Same layout in both skins; every colour reads the semantic
 * tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const pc = (v: unknown) => (v == null || v === '' ? '—' : `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`);

type Range = { from: string; to: string };
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const PRESETS: Array<{ key: string; label: string; range: (now: Date) => Range }> = [
  { key: 'month', label: 'This month', range: (now) => currentMonthRange(now) },
  { key: 'last', label: 'Last month', range: (now) => ({ from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) }) },
  { key: 'fy', label: 'This financial year', range: (now) => ({ from: financialYearRange(now).from, to: todayLocal(now) }) },
  { key: 'all', label: 'All time', range: () => ({ from: '', to: '' }) },
];
const HEADS = ['taxable', 'cgst', 'sgst', 'igst', 'cess', 'total'] as const;
const MODE_LABEL: Record<string, string> = { neft: 'NEFT', rtgs: 'RTGS', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer' };
const modeOf = (m: unknown) => MODE_LABEL[String(m ?? '').toLowerCase()] ?? (m ? String(m).replace(/_/g, ' ') : '—');

export default function BillingReportsPage() {
  const [gst, setGst] = useState<Row | null>(null);
  // Per report: why it failed to load, or null. Keeps a refused fetch from
  // rendering as "No X" — a lie about data that exists and could not be read.
  const [failed, setFailed] = useState<(string | null)[]>([]);
  const [sales, setSales] = useState<SalesRegister | null>(null);
  const [hsn, setHsn] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [gstr3b, setGstr3b] = useState<{ output: Row; itc: Row; net: Row } | null>(null);
  const [dayBook, setDayBook] = useState<{ rows: Row[]; totals: Row; byMode: Row[] } | null>(null);
  const [margin, setMargin] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [collection, setCollection] = useState<{ rows: Row[]; totals: Row; periodDays: number } | null>(null);
  // Opens on the current month rather than "everything" — see report-range.ts.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setError(null);
    setBusy(true);
    try {
      const from = r.from || undefined;
      const to = r.to || undefined;
      // allSettled, not all: these are eight independent reports, and one of them
      // failing (a register too wide for its cap, say) must not blank the other
      // seven that answered perfectly well.
      const out = await Promise.allSettled([
        billingReportsApi.gstSummary(from, to),
        billingReportsApi.salesRegister(from, to),
        billingReportsApi.hsnSummary(from, to),
        billingReportsApi.receiptsRegister(from, to),
        billingReportsApi.gstr3b(from, to),
        billingReportsApi.dayBook(from, to),
        billingReportsApi.gradeMargin(from, to),
        billingReportsApi.collectionEfficiency(from, to),
      ]);
      setGst(settledValue(out[0]));
      setSales(settledValue(out[1]));
      setHsn(settledValue(out[2]));
      setReceipts(settledValue(out[3]) ?? []);
      setGstr3b(settledValue(out[4]));
      setDayBook(settledValue(out[5]));
      setMargin(settledValue(out[6]));
      setCollection(settledValue(out[7]));
      setFailed(out.map(settledReason));
      const why = settledFailure(out);
      if (why) setError(why);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load(currentMonthRange()).catch((e) => setError(String(e)));
  }, [load]);

  function apply(r: Range) {
    setRange(r);
    setDraft(r);
    setMsg(null);
    load(r).catch((e) => setError(String(e)));
  }

  const now = new Date();
  const activePreset = PRESETS.find((p) => {
    const r = p.range(now);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;
  const periodLabel = range.from || range.to ? `${range.from ? formatDate(range.from) : 'the start'} → ${range.to ? formatDate(range.to) : 'today'}` : 'all time';

  const b2b = sales?.summary?.b2b;
  const b2c = sales?.summary?.b2c;
  const part = (k: string): Row | null => ((gst as Row | null)?.[k] as Row | undefined) ?? null;
  const cancelled = part('cancelled');
  const cancelledList = (cancelled?.invoices as Row[] | undefined) ?? [];
  const lossGrades = useMemo(() => (margin?.rows ?? []).filter((r) => num(r.grossMarginPerM3) < 0), [margin]);
  const slowPayers = useMemo(() => (collection?.rows ?? []).filter((r) => r.dsoDays != null && num(r.dsoDays) > 60), [collection]);
  const liveReceipts = useMemo(() => receipts.filter((r) => String(r.status) !== 'reversed'), [receipts]);
  const receiptsTotal = liveReceipts.reduce((t, r) => t + num(r.amount), 0);
  const netPayable = num(gstr3b?.net?.total);

  return (
    <div className="mn-ord mn-br">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Billing reports</h1>
          <p>The period&rsquo;s sales, tax and money in: what was invoiced and to whom, the GST that came with it and what is left to pay after input credit, what came in and how, which grades earn their keep, and who pays on time.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <BarChart3 size={14} aria-hidden />
            {loaded ? `${sales?.count ?? 0} ${sales?.count === 1 ? 'invoice' : 'invoices'} · ${moneyShort(num(sales?.total))}` : 'Loading…'}
          </span>
          <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => downloadTallyCsv().then(() => setMsg('The Tally sales CSV has been downloaded; import it in Tally under Vouchers.')).catch((e) => setError(String(e)))}>Tally CSV</Button>
          <Link href="/app/billing/sales-mis" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Layers size={14} />}>Sales MIS</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><Download size={16} aria-hidden /><span>{msg}</span></div>}

      {/* Period bar: the quick windows as chips, or any two dates; bounds every report by its own date. */}
      <div className="mn-dr-period" role="group" aria-label="Period for the reports">
        <div className="mn-board-strip">
          {PRESETS.map((p) => {
            const on = activePreset === p.key;
            return (
              <button key={p.key} type="button" className={`mn-board-chip mn-dr-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => apply(p.range(new Date()))}>
                <span className="mn-board-chip-l">{p.label}</span>
              </button>
            );
          })}
        </div>
        <form
          className="mn-dr-range"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <CalendarRange size={14} aria-hidden />
          <Input type="date" aria-label="From" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="mn-ord-meta">to</span>
          <Input type="date" aria-label="To" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <Button type="submit" variant="secondary" size="sm" disabled={busy || (draft.from === range.from && draft.to === range.to)}>Apply</Button>
        </form>
      </div>

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Invoiced" value={loaded ? moneyShort(num(sales?.total)) : '—'} tone="info" />
        <StatCard label="Taxable" value={loaded ? moneyShort(num(gst?.taxable)) : '—'} />
        <StatCard label="GST payable" value={loaded ? moneyShort(netPayable) : '—'} tone={netPayable > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Collected" value={loaded ? moneyShort(num(collection?.totals?.collected)) : '—'} tone={num(collection?.totals?.collected) > 0 ? 'success' : 'neutral'} />
        <StatCard label="Collection efficiency" value={loaded ? pc(collection?.totals?.efficiencyPct) : '—'} tone={collection?.totals?.efficiencyPct == null ? 'neutral' : num(collection.totals.efficiencyPct) >= 80 ? 'success' : 'warning'} />
      </div>

      {loaded && (num(cancelled?.count) > 0 || lossGrades.length > 0 || slowPayers.length > 0) && (
        <div className="mn-ord-notes">
          {num(cancelled?.count) > 0 && (
            <div className="mn-ord-note" role="status">
              <FileText size={16} aria-hidden />
              <span><strong>{num(cancelled?.count)} invoice {num(cancelled?.count) === 1 ? 'number was' : 'numbers were'} cancelled in the period ({cancelledList.map((c) => String(c.invoiceNo)).join(', ')}), {money(cancelled?.voidedValue)} in all.</strong> They stay out of the tax below; GSTR-1 wants them declared as cancelled, not left as a gap in the series.</span>
            </div>
          )}
          {lossGrades.length > 0 && (
            <a className="mn-ord-note mn-ord-note--bad" href="#margin">
              <TrendingDown size={16} aria-hidden />
              <span><strong>{lossGrades.map((r) => String(r.gradeLabel)).join(', ')} {lossGrades.length === 1 ? 'sold' : 'sold'} for less than the material in the mix.</strong> The rate does not cover cement and aggregates at standard cost, before labour or transport; check the rate or the recipe.</span>
            </a>
          )}
          {slowPayers.length > 0 && (
            <a className="mn-ord-note mn-ord-note--warn" href="#collections">
              <Wallet size={16} aria-hidden />
              <span><strong>{slowPayers.length} {slowPayers.length === 1 ? 'customer takes' : 'customers take'} more than 60 days to pay: {slowPayers.slice(0, 3).map((r) => String(r.customerName)).join(', ')}{slowPayers.length > 3 ? ` and ${slowPayers.length - 3} more` : ''}.</strong> See collection efficiency at the bottom.</span>
            </a>
          )}
        </div>
      )}

      <Card
        title={<span className="mn-board-card-title" id="gst"><Scale size={16} aria-hidden /> GST for the period</span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel}</span>
            {gstr3b ? <ExportButton rows={[{ ...(part('invoices') ?? {}), kind: 'Invoices' }, { ...(part('creditNotes') ?? {}), kind: 'Less credit notes' }, { ...(part('debitNotes') ?? {}), kind: 'Plus debit notes' }, { ...gstr3b.output, kind: 'Net output tax' }, { ...gstr3b.itc, kind: 'Less input credit' }, { ...gstr3b.net, kind: 'Net payable' }]} columns={['kind', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'total']} filename="gst-for-the-period" /> : null}
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : gst && gstr3b ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Head</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>CGST</Th>
                  <Th numeric>SGST</Th>
                  <Th numeric>IGST</Th>
                  <Th numeric>Cess</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Invoices issued', row: part('invoices') ?? gst, sign: '' },
                  ...(num(part('creditNotes')?.count) > 0 ? [{ label: `Less credit notes (${num(part('creditNotes')?.count)})`, row: part('creditNotes'), sign: '−' }] : []),
                  ...(num(part('debitNotes')?.count) > 0 ? [{ label: `Plus debit notes (${num(part('debitNotes')?.count)})`, row: part('debitNotes'), sign: '+' }] : []),
                ].map((line) => (
                  <tr key={line.label}>
                    <Td>{line.label}</Td>
                    {HEADS.map((k) => <Td key={k} numeric>{line.sign}{money(line.row?.[k])}</Td>)}
                  </tr>
                ))}
                <tr className="mn-br-sub">
                  <Td>Output tax on sales</Td>
                  {HEADS.map((k) => <Td key={k} numeric>{money(gstr3b.output[k])}</Td>)}
                </tr>
                <tr>
                  <Td>Less input credit on purchases</Td>
                  <Td numeric>−{money(gstr3b.itc.taxable)}</Td>
                  <Td numeric>−{money(gstr3b.itc.cgst)}</Td>
                  <Td numeric>−{money(gstr3b.itc.sgst)}</Td>
                  <Td numeric>−{money(gstr3b.itc.igst)}</Td>
                  <Td numeric><span className="mn-ord-meta">—</span></Td>
                  <Td numeric>−{money(gstr3b.itc.total)}</Td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td>Net GST payable (GSTR-3B)</Td>
                  <Td numeric><span className="mn-ord-meta">—</span></Td>
                  <Td numeric>{money(gstr3b.net.cgst)}</Td>
                  <Td numeric>{money(gstr3b.net.sgst)}</Td>
                  <Td numeric>{money(gstr3b.net.igst)}</Td>
                  <Td numeric>{money(gstr3b.net.cess)}</Td>
                  <Td numeric><span className="mn-ir-total-value">{money(gstr3b.net.total)}</span></Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[0] || failed[4] ? <ErrorState message={String(failed[0] ?? failed[4])} /> : (
          <EmptyState title="No tax in this period" description="Issued invoices carry the output tax; approved purchase bills the input credit. Widen the period." />
        )}
        <p className="mn-ir-foot">Output tax is what the issued invoices carried, net of credit / debit notes (GSTR-1 reports the notes in Table 9B). Input credit is the GST on approved, credit-eligible purchase bills in the period. The net is what GSTR-3B carries.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Layers size={16} aria-hidden /> HSN / SAC summary <span className="mn-board-card-count">{hsn?.rows.length ?? 0}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">GSTR-1 table 12</span>
            <ExportButton rows={hsn?.rows ?? []} columns={['hsn', 'gstRate', 'quantity', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'total']} filename="hsn-summary" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : hsn?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>HSN / SAC</Th>
                  <Th numeric>Rate</Th>
                  <Th numeric>Quantity</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>CGST</Th>
                  <Th numeric>SGST</Th>
                  <Th numeric>IGST</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {hsn.rows.map((r, i) => (
                  <tr key={i}>
                    <Td><span className="mn-od-num">{String(r.hsn)}</span></Td>
                    <Td numeric>{qty(r.gstRate)}%</Td>
                    <Td numeric>{qty(r.quantity)}</Td>
                    <Td numeric>{money(r.taxable)}</Td>
                    <Td numeric>{money(r.cgst)}</Td>
                    <Td numeric>{money(r.sgst)}</Td>
                    <Td numeric>{money(r.igst)}</Td>
                    <Td numeric><span className="mn-od-num">{money(r.total)}</span></Td>
                  </tr>
                ))}
              </tbody>
              {hsn.totals && (
                <tfoot>
                  <tr className="mn-ir-total">
                    <Td>All codes</Td>
                    <Td />
                    <Td numeric>{qty(hsn.totals.quantity)}</Td>
                    <Td numeric>{money(hsn.totals.taxable)}</Td>
                    <Td numeric>{money(hsn.totals.cgst)}</Td>
                    <Td numeric>{money(hsn.totals.sgst)}</Td>
                    <Td numeric>{money(hsn.totals.igst)}</Td>
                    <Td numeric><span className="mn-ir-total-value">{money(hsn.totals.total)}</span></Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : failed[2] ? <ErrorState message={String(failed[2])} /> : (
          <EmptyState title="No invoice lines in this period" description="Issued invoice lines summarise here by HSN code and rate. Widen the period." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Sales register <span className="mn-board-card-count">{sales?.count ?? 0}</span></span>}
        actions={
          <div className="mn-ir-tools">
            {b2b && b2c ? <span className="mn-ord-how">B2B {b2b.count} · {moneyShort(num(b2b.total))} · B2C {b2c.count} · {moneyShort(num(b2c.total))}</span> : null}
            <ExportButton rows={sales?.rows ?? []} columns={['invoiceNo', 'invoiceDate', 'customerName', 'gstin', 'placeOfSupply', 'taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'totalAmount']} filename="sales-register" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : sales?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Customer</Th>
                  <Th>Place of supply</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>GST</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {sales.rows.map((r) => (
                  <tr key={String(r.id)}>
                    <Td>
                      <Link href={`/app/billing/invoices/${String(r.id)}`} className="mn-id-link mn-od-num">{String(r.invoiceNo)}</Link>
                      <span className="mn-od-rate-meta">{formatDate(r.invoiceDate)}</span>
                    </Td>
                    <Td>
                      <span>{String(r.customerName ?? '—')}</span>
                      <span className="mn-od-rate-meta">{r.gstin ? String(r.gstin) : 'B2C · unregistered'}</span>
                    </Td>
                    <Td>{String(r.placeOfSupply ?? '—')}{r.isInterstate ? <span className="mn-od-rate-meta">inter-state · IGST</span> : null}</Td>
                    <Td numeric>{money(r.taxableAmount)}</Td>
                    <Td numeric>{money(num(r.cgstAmount) + num(r.sgstAmount) + num(r.igstAmount) + num(r.cessAmount))}</Td>
                    <Td numeric><span className="mn-od-num">{money(r.totalAmount)}</span></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td colSpan={3}>{sales.count} {sales.count === 1 ? 'invoice' : 'invoices'} · {periodLabel}</Td>
                  <Td numeric>{money(sales.taxable)}</Td>
                  <Td numeric>{money(num(sales.total) - num(sales.taxable))}</Td>
                  <Td numeric><span className="mn-ir-total-value">{money(sales.total)}</span></Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[1] ? <ErrorState message={String(failed[1])} /> : (
          <EmptyState title="No invoices issued in this period" description="Issued invoices list here by invoice date. Drafts and cancelled invoices are not sales." />
        )}
        {cancelledList.length > 0 ? <p className="mn-ir-foot">Cancelled in the period: {cancelledList.map((c) => `${String(c.invoiceNo)} (${formatDate(c.invoiceDate)}, ${money(c.totalAmount)})`).join('; ')}. Not part of the totals.</p> : null}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Receipt size={16} aria-hidden /> Credit and debit notes <span className="mn-board-card-count">{sales?.notes?.length ?? 0}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">GSTR-1 Table 9B</span>
            <ExportButton rows={sales?.notes ?? []} columns={['noteNo', 'noteType', 'noteDate', 'invoiceNo', 'customerName', 'gstin', 'reason', 'taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'totalAmount']} filename="credit-debit-notes" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : sales?.notes?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Note</Th>
                  <Th>Against</Th>
                  <Th>Reason</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>GST</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {sales.notes.map((n) => (
                  <tr key={String(n.id)}>
                    <Td>
                      <span className="mn-cs-entry"><Badge tone={n.noteType === 'debit' ? 'warning' : 'success'}>{n.noteType === 'debit' ? 'Debit' : 'Credit'}</Badge> <span className="mn-od-num">{String(n.noteNo)}</span></span>
                      <span className="mn-od-rate-meta">{formatDate(n.noteDate)}</span>
                    </Td>
                    <Td>
                      <span>{String(n.invoiceNo ?? '—')}</span>
                      <span className="mn-od-rate-meta">{String(n.customerName ?? '')}</span>
                    </Td>
                    <Td>{String(n.reason ?? '—').replace(/_/g, ' ')}</Td>
                    <Td numeric>{money(n.taxableAmount)}</Td>
                    <Td numeric>{money(num(n.cgstAmount) + num(n.sgstAmount) + num(n.igstAmount) + num(n.cessAmount))}</Td>
                    <Td numeric><span className="mn-od-num">{money(n.totalAmount)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : failed[1] ? <ErrorState message={String(failed[1])} /> : (
          <EmptyState title="No notes in this period" description="A credit note cuts what a customer owes on an issued invoice; a debit note adds to it. Raise one from the invoice." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Landmark size={16} aria-hidden /> Receipts register <span className="mn-board-card-count">{receipts.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel} · {moneyShort(receiptsTotal)} received</span>
            <ExportButton rows={receipts} columns={['receiptNo', 'receiptDate', 'customerName', 'paymentMode', 'bankReference', 'amount', 'allocatedAmount', 'unallocatedAmount', 'status', 'clearingStatus']} filename="receipts-register" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : receipts.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>From</Th>
                  <Th>How</Th>
                  <Th numeric>Amount</Th>
                  <Th numeric>Applied</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const reversed = String(r.status) === 'reversed';
                  return (
                    <tr key={String(r.id)} className={reversed ? 'mn-br-void' : undefined}>
                      <Td>
                        <span className="mn-od-num">{String(r.receiptNo)}</span>
                        <span className="mn-od-rate-meta">{formatDate(r.receiptDate)}</span>
                      </Td>
                      <Td>{String(r.customerName ?? '—')}</Td>
                      <Td>{modeOf(r.paymentMode)}{r.bankReference ? <span className="mn-od-rate-meta">{String(r.bankReference)}</span> : null}</Td>
                      <Td numeric><span className="mn-od-num">{money(r.amount)}</span></Td>
                      <Td numeric>{money(r.allocatedAmount)}{num(r.unallocatedAmount) > 0.001 && !reversed ? <span className="mn-od-rate-meta">{money(r.unallocatedAmount)} on account</span> : null}</Td>
                      <Td><StatusBadge status={reversed ? 'reversed' : String(r.clearingStatus ?? '') === 'pending' ? 'pending' : 'posted'} /></Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td colSpan={3}>{liveReceipts.length} {liveReceipts.length === 1 ? 'receipt' : 'receipts'} standing{receipts.length - liveReceipts.length ? ` · ${receipts.length - liveReceipts.length} reversed` : ''}</Td>
                  <Td numeric><span className="mn-ir-total-value">{money(receiptsTotal)}</span></Td>
                  <Td numeric>{money(liveReceipts.reduce((t, r) => t + num(r.allocatedAmount), 0))}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[3] ? <ErrorState message={String(failed[3])} /> : (
          <EmptyState title="No receipts in this period" description="Money recorded under Receipts lists here by receipt date." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><BookOpen size={16} aria-hidden /> Cash and bank day book <span className="mn-board-card-count">{dayBook?.rows.length ?? 0}</span></span>}
        actions={<ExportButton rows={dayBook?.rows ?? []} columns={['date', 'kind', 'ref', 'mode', 'party', 'inflow', 'outflow']} filename="day-book" />}
        padded={false}
      >
        {dayBook?.totals ? (
          <div className="mn-dc-wsum">
            <span>In <strong className="mn-st-in">{money(dayBook.totals.inflow)}</strong></span>
            <span>Out <strong className="mn-st-out">{money(dayBook.totals.outflow)}</strong></span>
            <span>Net <strong className={num(dayBook.totals.net) < 0 ? 'mn-id-bad' : undefined}>{money(dayBook.totals.net)}</strong></span>
            {(dayBook.byMode ?? []).map((m) => <span key={String(m.mode)}>{modeOf(m.mode)} <strong>{money(m.net)}</strong></span>)}
          </div>
        ) : null}
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : dayBook?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Entry</Th>
                  <Th>Party</Th>
                  <Th>How</Th>
                  <Th numeric>In</Th>
                  <Th numeric>Out</Th>
                </tr>
              </thead>
              <tbody>
                {dayBook.rows.map((r, i) => (
                  <tr key={i}>
                    <Td>{formatDate(r.date)}</Td>
                    <Td><span className="mn-cs-entry"><Badge tone={num(r.inflow) > 0 ? 'success' : 'warning'}>{String(r.kind)}</Badge> <span className="mn-od-num">{String(r.ref)}</span></span></Td>
                    <Td>{r.party ? String(r.party) : <span className="mn-ord-meta">—</span>}</Td>
                    <Td>{modeOf(r.mode)}</Td>
                    <Td numeric>{num(r.inflow) ? <span className="mn-st-in">{money(r.inflow)}</span> : ''}</Td>
                    <Td numeric>{num(r.outflow) ? <span className="mn-st-out">{money(r.outflow)}</span> : ''}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td colSpan={4}>{dayBook.rows.length} {dayBook.rows.length === 1 ? 'entry' : 'entries'} · {periodLabel}</Td>
                  <Td numeric>{money(dayBook.totals.inflow)}</Td>
                  <Td numeric>{money(dayBook.totals.outflow)}</Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[5] ? <ErrorState message={String(failed[5])} /> : (
          <EmptyState title="No money moved in this period" description="Receipts come in; vendor payments and expense vouchers go out. Each appears here on its date." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title" id="margin"><TrendingDown size={16} aria-hidden /> Margin per m³ by grade <span className="mn-board-card-count">{margin?.rows.length ?? 0}</span></span>}
        actions={
          <div className="mn-ir-tools">
            {margin?.totals ? <span className="mn-ord-how">{money(margin.totals.grossMarginPerM3)}/m³ over material · {pc(margin.totals.marginPct)}</span> : null}
            <ExportButton rows={margin?.rows ?? []} columns={['gradeLabel', 'volumeM3', 'revenue', 'revenuePerM3', 'stdMaterialCostPerM3', 'grossMarginPerM3', 'marginPct']} filename="margin-per-m3" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : margin?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Grade</Th>
                  <Th numeric>Invoiced</Th>
                  <Th numeric>Sold at /m³</Th>
                  <Th numeric>Material /m³</Th>
                  <Th numeric>Margin /m³</Th>
                  <Th numeric>Margin</Th>
                </tr>
              </thead>
              <tbody>
                {margin.rows.map((r, i) => {
                  const m = num(r.grossMarginPerM3);
                  return (
                    <tr key={i}>
                      <Td><span className="mn-od-num">{String(r.gradeLabel ?? '')}</span></Td>
                      <Td numeric>{qty(r.volumeM3)} m³<span className="mn-od-rate-meta">{money(r.revenue)}</span></Td>
                      <Td numeric>{money(r.revenuePerM3)}</Td>
                      <Td numeric>{money(r.stdMaterialCostPerM3)}</Td>
                      <Td numeric><span className={m < 0 ? 'mn-st-out' : m > 0 ? 'mn-st-in' : undefined}>{m < 0 ? '−' : ''}{money(Math.abs(m))}</span></Td>
                      <Td numeric><span className={m < 0 ? 'mn-id-bad' : 'mn-od-num'}>{pc(r.marginPct)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
              {margin.totals && (
                <tfoot>
                  <tr className="mn-ir-total">
                    <Td>All grades</Td>
                    <Td numeric>{qty(margin.totals.volumeM3)} m³</Td>
                    <Td numeric>{money(margin.totals.revenuePerM3)}</Td>
                    <Td numeric>{money(num(margin.totals.stdMaterialCost) / (num(margin.totals.volumeM3) || 1))}</Td>
                    <Td numeric><span className={num(margin.totals.grossMarginPerM3) < 0 ? 'mn-st-out' : 'mn-st-in'}>{num(margin.totals.grossMarginPerM3) < 0 ? '−' : ''}{money(Math.abs(num(margin.totals.grossMarginPerM3)))}</span></Td>
                    <Td numeric><span className="mn-ir-total-value">{pc(margin.totals.marginPct)}</span></Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : failed[6] ? <ErrorState message={String(failed[6])} /> : (
          <EmptyState title="No graded sales in this period" description="Needs issued invoices with grade lines, and an approved mix design for each grade to cost the material against." />
        )}
        <p className="mn-ir-foot">Material per m³ is the approved mix design&rsquo;s recipe at each material&rsquo;s standard rate. The margin is over material only: labour, power, transport and overheads still come out of it, so a thin margin here is a loss in truth.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title" id="collections"><Wallet size={16} aria-hidden /> Who pays on time <span className="mn-board-card-count">{collection?.rows.length ?? 0}</span></span>}
        actions={
          <div className="mn-ir-tools">
            {collection?.totals ? <span className="mn-ord-how">{pc(collection.totals.efficiencyPct)} collected · DSO {collection.totals.dsoDays == null ? '—' : `${qty(collection.totals.dsoDays)} days`}</span> : null}
            <ExportButton rows={collection?.rows ?? []} columns={['customerName', 'billed', 'collected', 'outstanding', 'efficiencyPct', 'dsoDays']} filename="collection-efficiency" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : collection?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th numeric>Billed</Th>
                  <Th numeric>Collected</Th>
                  <Th numeric>Still owed</Th>
                  <Th numeric>Collected</Th>
                  <Th numeric>Days to pay</Th>
                </tr>
              </thead>
              <tbody>
                {collection.rows.map((r, i) => {
                  const dso = r.dsoDays == null ? null : num(r.dsoDays);
                  return (
                    <tr key={i}>
                      <Td><span className="mn-od-num">{String(r.customerName ?? '')}</span></Td>
                      <Td numeric>{money(r.billed)}</Td>
                      <Td numeric>{money(r.collected)}</Td>
                      <Td numeric>{num(r.outstanding) > 0 ? <span className="mn-ir-low">{money(r.outstanding)}</span> : money(0)}</Td>
                      <Td numeric>{pc(r.efficiencyPct)}</Td>
                      <Td numeric><span className={dso != null && dso > 90 ? 'mn-id-bad' : dso != null && dso > 60 ? 'mn-ir-low' : undefined}>{dso == null ? '—' : `${qty(dso)} d`}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
              {collection.totals && (
                <tfoot>
                  <tr className="mn-ir-total">
                    <Td>All customers</Td>
                    <Td numeric>{money(collection.totals.billed)}</Td>
                    <Td numeric>{money(collection.totals.collected)}</Td>
                    <Td numeric>{money(collection.totals.outstanding)}</Td>
                    <Td numeric><span className="mn-ir-total-value">{pc(collection.totals.efficiencyPct)}</span></Td>
                    <Td numeric>{collection.totals.dsoDays == null ? '—' : `${qty(collection.totals.dsoDays)} d`}</Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : failed[7] ? <ErrorState message={String(failed[7])} /> : (
          <EmptyState title="No billing in this period" description="Issue invoices and record receipts to see how much of what was billed came in, and how long it took." />
        )}
        <p className="mn-ir-foot">Billed and collected are for the period; still owed is the balance today. Collected is what came in as a share of what was billed. Days to pay is the outstanding spread over the period&rsquo;s billing ({collection?.periodDays ?? 0} days), the usual DSO measure; slowest payers first.</p>
      </Card>
    </div>
  );
}
