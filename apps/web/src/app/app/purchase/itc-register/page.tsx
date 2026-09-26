'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CalendarRange, FileText, Receipt, RefreshCw } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { currentMonthRange, financialYearRange, todayLocal } from '../../../../lib/report-range';
import { money, moneyShort } from '../../../../lib/money';
import { purchaseApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Input tax credit register — the GST on approved purchase bills that can be
 * claimed back, for the month's return and for matching against GSTR-2B.
 *
 * A period bar (this month, last month, this financial year, all time, or
 * any two dates) bounds it by bill date; five tiles sum the period up; the
 * register lists each bill with the supplier's GSTIN and the credit split
 * into CGST / SGST or IGST, with a total row and a foot that says what is
 * in and what is out. Same layout in both skins; every colour reads the
 * semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

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

export default function ItcRegisterPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  // ITC is claimed monthly, so open on the current month.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setError(null);
    setBusy(true);
    try {
      setData(await purchaseApi.itcRegister(r.from || undefined, r.to || undefined));
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
  const rows = data?.rows ?? [];
  const t = data?.totals;
  const credit = num(t?.cgst) + num(t?.sgst) + num(t?.igst);
  const noGstin = rows.filter((r) => !r.gstin).length;

  return (
    <div className="mn-ord mn-itc">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Input tax credit register</h1>
          <p>The GST you paid on approved purchase bills that you can claim back against the GST you collected. One line per bill with the supplier&rsquo;s GSTIN and the credit split the way the return wants it, so it can be matched against GSTR-2B before filing.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Receipt size={14} aria-hidden />
            {loaded ? `${rows.length} ${rows.length === 1 ? 'bill' : 'bills'} · ${moneyShort(credit)} credit` : 'Loading…'}
          </span>
          <Link href="/app/purchase/bills" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<FileText size={14} />}>Vendor bills</Button>
          </Link>
          <Link href="/app/billing/reports" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<BarChart3 size={14} />}>GST payable</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}

      {/* Period bar: the quick windows as chips, or any two dates; bounds by bill date. */}
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

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Credit to claim" value={loaded ? moneyShort(credit) : '—'} tone={credit > 0 ? 'success' : 'neutral'} />
        <StatCard label="Taxable purchases" value={loaded ? moneyShort(num(t?.taxable)) : '—'} />
        <StatCard label="CGST" value={loaded ? moneyShort(num(t?.cgst)) : '—'} />
        <StatCard label="SGST" value={loaded ? moneyShort(num(t?.sgst)) : '—'} />
        <StatCard label="IGST" value={loaded ? moneyShort(num(t?.igst)) : '—'} tone={num(t?.igst) > 0 ? 'info' : 'neutral'} />
      </div>

      {loaded && noGstin > 0 && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Receipt size={16} aria-hidden />
          <span><strong>{noGstin} {noGstin === 1 ? 'bill has' : 'bills have'} no supplier GSTIN.</strong> Credit cannot be claimed on a bill from an unregistered supplier; add the GSTIN under Masters › Suppliers if they are registered.</span>
        </div>
      )}

      <Card
        title={<span className="mn-board-card-title"><Receipt size={16} aria-hidden /> Register <span className="mn-board-card-count">{rows.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel}</span>
            <ExportButton rows={rows} columns={['billNo', 'supplierBillNo', 'billDate', 'supplierName', 'gstin', 'taxable', 'cgst', 'sgst', 'igst', 'total']} filename="itc-register" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Bill</Th>
                  <Th>Supplier</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>CGST</Th>
                  <Th numeric>SGST</Th>
                  <Th numeric>IGST</Th>
                  <Th numeric>Credit</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <Td>
                      <span className="mn-od-num">{String(r.billNo)}</span>
                      <span className="mn-od-rate-meta">{formatDate(r.billDate)}{r.supplierBillNo ? ` · their no. ${String(r.supplierBillNo)}` : ''}</span>
                    </Td>
                    <Td>
                      <span>{String(r.supplierName ?? '—')}</span>
                      <span className="mn-od-rate-meta">{r.gstin ? String(r.gstin) : <span className="mn-ir-low">no GSTIN</span>}</span>
                    </Td>
                    <Td numeric>{money(r.taxable)}</Td>
                    <Td numeric>{num(r.cgst) ? money(r.cgst) : <span className="mn-ord-meta">—</span>}</Td>
                    <Td numeric>{num(r.sgst) ? money(r.sgst) : <span className="mn-ord-meta">—</span>}</Td>
                    <Td numeric>{num(r.igst) ? money(r.igst) : <span className="mn-ord-meta">—</span>}</Td>
                    <Td numeric><span className="mn-od-num">{money(num(r.cgst) + num(r.sgst) + num(r.igst))}</span></Td>
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr className="mn-ir-total">
                    <Td colSpan={2}>{String(t.count ?? rows.length)} {num(t.count ?? rows.length) === 1 ? 'bill' : 'bills'} · {periodLabel}</Td>
                    <Td numeric>{money(t.taxable)}</Td>
                    <Td numeric>{money(t.cgst)}</Td>
                    <Td numeric>{money(t.sgst)}</Td>
                    <Td numeric>{money(t.igst)}</Td>
                    <Td numeric><span className="mn-ir-total-value">{money(credit)}</span></Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : (
          <EmptyState title="No credit in this period" description={`No approved, credit-eligible vendor bills dated between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}. Approve the bills under Vendor bills, or widen the period.`} action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
        )}
        <p className="mn-ir-foot">Only approved bills marked as credit-eligible are listed; a bill ticked as blocked credit (section 17(5)) stays out. A supplier in your state splits the tax into CGST and SGST; one in another state charges IGST. The total here is what GSTR-3B deducts from the GST payable.</p>
      </Card>
    </div>
  );
}
