'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CalendarRange, Factory, FileText, Layers, RefreshCw, Users } from 'lucide-react';
import { currentMonthRange, financialYearRange, todayLocal } from '../../../../lib/report-range';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { billingReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Sales MIS — who bought, from which plant, and which grades, for a period.
 *
 * A period bar (this month, last month, this financial year, all time, or
 * any two dates) bounds three views of the same issued invoices: by
 * customer, by plant and by grade, each with its share of the period's
 * sales as a bar and a total row. Four tiles sum the period up. Same layout
 * in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%` : '—');

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

function DimCard({ icon, title, rows, nameKey, nameLabel, file, loaded, total, extraKey, showQty, showInvoices, empty }: {
  icon: React.ReactNode; title: string; rows: Row[]; nameKey: string; nameLabel: string; file: string; loaded: boolean; total: number;
  extraKey?: string; showQty?: boolean; showInvoices?: boolean; empty: string;
}) {
  const columns = [nameKey, ...(extraKey ? [extraKey] : []), ...(showInvoices ? ['invoices'] : []), ...(showQty ? ['quantity'] : []), 'taxable', 'total'];
  const top = rows.reduce((t, r) => Math.max(t, num(r.total)), 0);
  const sumTaxable = rows.reduce((t, r) => t + num(r.taxable), 0);
  const sumTotal = rows.reduce((t, r) => t + num(r.total), 0);
  const sumQty = rows.reduce((t, r) => t + num(r.quantity), 0);
  const sumInv = rows.reduce((t, r) => t + num(r.invoices), 0);
  return (
    <Card
      title={<span className="mn-board-card-title">{icon} {title} <span className="mn-board-card-count">{rows.length}</span></span>}
      actions={<ExportButton rows={rows} columns={columns} filename={file} />}
      padded={false}
    >
      {!loaded ? (
        <TableSkeleton cols={4} />
      ) : rows.length ? (
        <div className="mn-id-scroll">
          <Table>
            <thead>
              <tr>
                <Th>{nameLabel}</Th>
                {showInvoices ? <Th numeric>Invoices</Th> : null}
                {showQty ? <Th numeric>Quantity</Th> : null}
                <Th numeric>Taxable</Th>
                <Th numeric>Invoiced</Th>
                <Th numeric>Share</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <Td>
                    <span className="mn-od-num">{String(r[nameKey] ?? '—')}</span>
                    {extraKey && r[extraKey] ? <span className="mn-od-rate-meta">{String(r[extraKey]).replace(/_/g, ' ').toUpperCase()}</span> : null}
                  </Td>
                  {showInvoices ? <Td numeric>{String(r.invoices ?? 0)}</Td> : null}
                  {showQty ? <Td numeric>{qty(r.quantity)} m³</Td> : null}
                  <Td numeric>{money(r.taxable)}</Td>
                  <Td numeric><span className="mn-od-num">{money(r.total)}</span></Td>
                  <Td numeric>
                    {pct(num(r.total), total)}
                    <span className="mn-od-linebar mn-pr-bar" aria-hidden><span style={{ width: `${top > 0 ? Math.max(4, (num(r.total) / top) * 100) : 0}%` }} /></span>
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="mn-ir-total">
                <Td>All</Td>
                {showInvoices ? <Td numeric>{sumInv}</Td> : null}
                {showQty ? <Td numeric>{qty(sumQty)} m³</Td> : null}
                <Td numeric>{money(sumTaxable)}</Td>
                <Td numeric><span className="mn-ir-total-value">{money(sumTotal)}</span></Td>
                <Td numeric>100%</Td>
              </tr>
            </tfoot>
          </Table>
        </div>
      ) : (
        <EmptyState title="No sales in this period" description={empty} />
      )}
    </Card>
  );
}

export default function SalesMisPage() {
  const [data, setData] = useState<{ byCustomer: Row[]; byPlant: Row[]; byGrade: Row[]; totals: Row } | null>(null);
  // Opens on the current month rather than every invoice ever raised.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setError(null);
    setBusy(true);
    try {
      setData(await billingReportsApi.salesMis(r.from || undefined, r.to || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    load(r).catch((e) => setError(String(e)));
  }

  const now = new Date();
  const activePreset = PRESETS.find((p) => {
    const r = p.range(now);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;
  const periodLabel = range.from || range.to ? `${range.from ? formatDate(range.from) : 'the start'} → ${range.to ? formatDate(range.to) : 'today'}` : 'all time';
  const t = data?.totals;
  const total = num(t?.total);
  const volume = useMemo(() => (data?.byGrade ?? []).reduce((s, r) => s + num(r.quantity), 0), [data]);
  const topCustomer = data?.byCustomer?.[0];

  return (
    <div className="mn-ord mn-mis">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Sales MIS</h1>
          <p>The period&rsquo;s issued invoices sliced three ways: who bought, which plant supplied, and which grades sold. Each view carries its share of the period, so the biggest customer, plant and grade stand out at a glance.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <BarChart3 size={14} aria-hidden />
            {loaded ? `${num(t?.invoices)} ${num(t?.invoices) === 1 ? 'invoice' : 'invoices'} · ${moneyShort(total)}` : 'Loading…'}
          </span>
          <Link href="/app/billing/reports" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<FileText size={14} />}>Billing reports</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}

      {/* Period bar: the quick windows as chips, or any two dates; bounds by invoice date. */}
      <div className="mn-dr-period" role="group" aria-label="Period">
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

      <div className="mn-od-kpis mn-cs-kpis">
        <StatCard label="Invoiced" value={loaded ? moneyShort(total) : '—'} tone="info" />
        <StatCard label="Taxable" value={loaded ? moneyShort(num(t?.taxable)) : '—'} />
        <StatCard label="Volume invoiced" value={loaded ? `${qty(volume)} m³` : '—'} tone={volume > 0 ? 'success' : 'neutral'} />
        <StatCard label="Biggest customer" value={loaded && topCustomer ? pct(num(topCustomer.total), total) : '—'} tone={topCustomer && num(topCustomer.total) / (total || 1) > 0.5 ? 'warning' : 'neutral'} />
      </div>

      {loaded && topCustomer && num(topCustomer.total) / (total || 1) > 0.5 && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Users size={16} aria-hidden />
          <span><strong>{String(topCustomer.customerName)} is {pct(num(topCustomer.total), total)} of the period&rsquo;s sales.</strong> One customer carrying more than half the billing is a risk to the plant if they slow down or fall behind on payment.</span>
        </div>
      )}

      <DimCard icon={<Users size={16} aria-hidden />} title="By customer" rows={data?.byCustomer ?? []} nameKey="customerName" nameLabel="Customer" file="sales-mis-by-customer" loaded={loaded} total={total} extraKey="customerType" showInvoices empty={`No issued invoices between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}. Widen the period.`} />
      <DimCard icon={<Factory size={16} aria-hidden />} title="By plant" rows={data?.byPlant ?? []} nameKey="plantName" nameLabel="Plant" file="sales-mis-by-plant" loaded={loaded} total={total} showInvoices empty="Issued invoices are grouped by the plant on the invoice." />
      <DimCard icon={<Layers size={16} aria-hidden />} title="By grade" rows={data?.byGrade ?? []} nameKey="grade" nameLabel="Grade" file="sales-mis-by-grade" loaded={loaded} total={(data?.byGrade ?? []).reduce((s, r) => s + num(r.total), 0)} showQty empty="Issued invoice lines are grouped by their concrete grade." />
      <p className="mn-ord-how">{periodLabel}, by invoice date; issued invoices only. Invoiced is the total with GST; taxable is before GST. The grade view is by line, so its total can differ from the customer view when an invoice carries lines without a grade.</p>
    </div>
  );
}
