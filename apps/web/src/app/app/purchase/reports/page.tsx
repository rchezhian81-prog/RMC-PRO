'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BarChart3, BookOpen, CalendarRange, FileText, Package, RefreshCw, Store, Users, Wallet } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { currentMonthRange, financialYearRange, settledFailure, settledValue, settledReason, todayLocal } from '../../../../lib/report-range';
import { money, moneyShort } from '../../../../lib/money';
import { crud, purchaseReportsApi, type Row, type VendorLedger } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input, Select } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Purchase reports — what you owe suppliers and what you bought.
 *
 * Five tiles sum the payables up (owed, older than 90 days, bought in the
 * period, its tax, bills); a note names the suppliers with money older than
 * 90 days; a period bar bounds the register and the ledger (the ageing is
 * as of today). Then who you owe, as one row per supplier with the age of
 * the money as a bar; the purchase register for the period with a total;
 * the same purchases by material and by supplier side by side; and a
 * supplier's ledger (bills up, payments down, running balance) for the one
 * you pick. Each card checks its own settled slot first. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

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
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const BUCKETS: Array<{ key: string; label: string; tone: Tone }> = [
  { key: 'b0_30', label: '≤30 d', tone: 'success' },
  { key: 'b31_60', label: '31–60 d', tone: 'info' },
  { key: 'b61_90', label: '61–90 d', tone: 'warning' },
  { key: 'b90', label: '>90 d', tone: 'danger' },
];

export default function PurchaseReportsPage() {
  const [aging, setAging] = useState<{ rows: Row[]; totals: Row } | null>(null);
  // Per report: why it failed to load, or null. Keeps a refused fetch from
  // rendering as "No X" — a lie about data that exists and could not be read.
  const [failed, setFailed] = useState<(string | null)[]>([]);
  const [register, setRegister] = useState<{ rows: Row[]; byVendor: Row[]; byMaterial: Row[]; totals: Row } | null>(null);
  const [ledger, setLedger] = useState<VendorLedger | null>(null);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [supplierId, setSupplierId] = useState('');
  // Bounds the purchase register and the ledger; payables ageing is as of today.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range, sid: string) => {
    setError(null);
    setBusy(true);
    try {
      // allSettled: the ageing, the register and the ledger are independent;
      // one failing must not blank the others.
      const out = await Promise.allSettled([
        purchaseReportsApi.payablesAging(),
        purchaseReportsApi.purchaseRegister(r.from || undefined, r.to || undefined),
        sid ? purchaseReportsApi.vendorLedger(sid, r.from || undefined, r.to || undefined) : Promise.resolve(null),
      ]);
      setAging(settledValue(out[0]));
      setRegister(settledValue(out[1]));
      setLedger(settledValue(out[2]) ?? null);
      setFailed(out.map(settledReason));
      const why = settledFailure(out);
      if (why) setError(why);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    crud('suppliers').list().then(setSuppliers).catch((e) => setError(String(e)));
    load(currentMonthRange(), '').catch((e) => setError(String(e)));
  }, [load]);

  function apply(r: Range) {
    setRange(r);
    setDraft(r);
    load(r, supplierId).catch((e) => setError(String(e)));
  }
  function pick(sid: string) {
    setSupplierId(sid);
    load(range, sid).catch((e) => setError(String(e)));
  }

  const now = new Date();
  const activePreset = PRESETS.find((p) => {
    const r = p.range(now);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;
  const periodLabel = range.from || range.to ? `${range.from ? formatDate(range.from) : 'the start'} → ${range.to ? formatDate(range.to) : 'today'}` : 'all time';
  const aRows = useMemo(() => [...(aging?.rows ?? [])].sort((a, b) => num(b.b90) - num(a.b90) || num(b.b61_90) - num(a.b61_90) || num(b.total) - num(a.total)), [aging]);
  const at = aging?.totals;
  const rRows = register?.rows ?? [];
  const rt = register?.totals;
  const over90 = aRows.filter((r) => num(r.b90) > 0.001);
  const supplier = suppliers.find((s) => String(s.id) === supplierId);
  const topVendor = register?.byVendor?.[0];
  const registerTotal = num(rt?.total);

  return (
    <div className="mn-ord mn-pr2">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Purchase reports</h1>
          <p>What you owe your suppliers and how old that money is, what you bought in the period and from whom, and any one supplier&rsquo;s account: their bills, your payments, and the balance between.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Wallet size={14} aria-hidden />
            {loaded ? `${moneyShort(num(at?.total))} owed to ${aRows.length} ${aRows.length === 1 ? 'supplier' : 'suppliers'}` : 'Loading…'}
          </span>
          <Link href="/app/purchase/bills" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<FileText size={14} />}>Vendor bills</Button>
          </Link>
          <Link href="/app/purchase/itc-register" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<BarChart3 size={14} />}>ITC register</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}

      {loaded && over90.length > 0 && (
        <div className="mn-ord-notes">
          <div className="mn-ord-note mn-ord-note--bad">
            <AlertTriangle size={16} aria-hidden />
            <span><strong>{moneyShort(num(at?.b90))} has been owed for more than 90 days to {over90.length} {over90.length === 1 ? 'supplier' : 'suppliers'}: {over90.slice(0, 3).map((r) => String(r.supplierName)).join(', ')}{over90.length > 3 ? ` and ${over90.length - 3} more` : ''}.</strong> A supplier left unpaid this long stops deliveries; settle it or agree a date.</span>
          </div>
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Owed to suppliers" value={loaded ? moneyShort(num(at?.total)) : '—'} tone={num(at?.total) > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Over 90 days" value={loaded ? moneyShort(num(at?.b90)) : '—'} tone={num(at?.b90) > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Bought in the period" value={loaded ? moneyShort(registerTotal) : '—'} tone="info" />
        <StatCard label="Tax on purchases" value={loaded ? moneyShort(num(rt?.tax)) : '—'} />
        <StatCard label="Bills in the period" value={loaded ? String(rt?.count ?? 0) : '—'} />
      </div>

      {/* Period bar: bounds the register, the breakdowns and the ledger; the ageing is as of today. */}
      <div className="mn-dr-period" role="group" aria-label="Period for the register and the ledger">
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

      <Card
        title={<span className="mn-board-card-title"><Users size={16} aria-hidden /> Who you owe <span className="mn-board-card-count">{aRows.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">As of today, by bill date. Oldest money first.</span>
            <ExportButton rows={aRows} columns={['supplierName', 'gstin', 'contactPerson', 'mobile', 'total', 'b0_30', 'b31_60', 'b61_90', 'b90']} filename="payables-aging" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={4} /></div>
        ) : aRows.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-pr2-cols" aria-hidden>
              <span>Supplier</span>
              <span>Age of the money</span>
              <span className="is-num">Owed</span>
            </div>
            {aRows.map((r, i) => {
              const total = num(r.total);
              const segs = BUCKETS.map((b) => ({ ...b, amount: num(r[b.key]), pct: total > 0 ? (num(r[b.key]) / total) * 100 : 0 })).filter((s) => s.amount > 0.001);
              const worst = [...segs].reverse()[0]?.tone ?? 'neutral';
              const contact = [r.contactPerson, r.mobile].filter(Boolean).map(String).join(' · ');
              return (
                <div key={i} className="mn-ord-row mn-pr2-row" data-tone={worst} role="listitem">
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.supplierName ?? 'Unknown')}</span>
                    <span className="mn-ord-meta">{contact || (r.gstin ? String(r.gstin) : 'No contact on file')}</span>
                  </div>
                  <div className="mn-ao-age">
                    <span className="mn-ao-bar" role="img" aria-label={segs.map((s) => `${s.label}: ${money(s.amount)}`).join(', ')}>
                      {segs.map((s) => <span key={s.key} data-tone={s.tone} style={{ width: `${s.pct}%` }} title={`${s.label}: ${money(s.amount)}`} />)}
                    </span>
                    <span className="mn-ord-meta mn-ao-age-text">
                      {segs.map((s, j) => <span key={s.key} data-tone={s.tone}>{j > 0 ? ' · ' : ''}{moneyShort(s.amount)} <em>{s.label}</em></span>)}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(total)}</span>
                    <span className="mn-ord-meta">{num(r.b90) > 0.001 ? <span className="mn-ao-overdue">{moneyShort(num(r.b90))} over 90 days</span> : 'nothing over 90 days'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : failed[0] ? <ErrorState message={String(failed[0])} /> : (
          <EmptyState title="Nothing owed to suppliers" description="An approved vendor bill with a balance appears here, aged from its bill date. Everything approved has been paid." />
        )}
        {at && aRows.length ? <p className="mn-ir-foot">All suppliers: {money(at.total)} owed, of which {moneyShort(num(at.b0_30))} up to 30 days, {moneyShort(num(at.b31_60))} at 31–60, {moneyShort(num(at.b61_90))} at 61–90 and {moneyShort(num(at.b90))} over 90 days.</p> : null}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Purchase register <span className="mn-board-card-count">{rRows.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel} · approved bills</span>
            <ExportButton rows={rRows} columns={['billNo', 'supplierBillNo', 'billDate', 'supplierName', 'gstin', 'taxable', 'tax', 'total', 'matchStatus']} filename="purchase-register" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rRows.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Bill</Th>
                  <Th>Supplier</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>GST</Th>
                  <Th numeric>Total</Th>
                  <Th>Match</Th>
                </tr>
              </thead>
              <tbody>
                {rRows.map((r, i) => (
                  <tr key={i}>
                    <Td>
                      <span className="mn-od-num">{String(r.billNo)}</span>
                      <span className="mn-od-rate-meta">{formatDate(r.billDate)}{r.supplierBillNo ? ` · their no. ${String(r.supplierBillNo)}` : ''}</span>
                    </Td>
                    <Td>
                      <span>{String(r.supplierName ?? '—')}</span>
                      {r.gstin ? <span className="mn-od-rate-meta">{String(r.gstin)}</span> : null}
                    </Td>
                    <Td numeric>{money(r.taxable)}</Td>
                    <Td numeric>{money(r.tax)}</Td>
                    <Td numeric><span className="mn-od-num">{money(r.total)}</span></Td>
                    <Td>{String(r.matchStatus) === 'matched' ? <Badge tone="success">matched</Badge> : String(r.matchStatus) === 'over_tolerance' ? <Badge tone="danger">did not match</Badge> : <Badge tone="neutral">not matched</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
              {rt && (
                <tfoot>
                  <tr className="mn-ir-total">
                    <Td colSpan={2}>{String(rt.count ?? rRows.length)} {num(rt.count ?? rRows.length) === 1 ? 'bill' : 'bills'} · {periodLabel}</Td>
                    <Td numeric>{money(rt.taxable)}</Td>
                    <Td numeric>{money(rt.tax)}</Td>
                    <Td numeric><span className="mn-ir-total-value">{money(rt.total)}</span></Td>
                    <Td />
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : failed[1] ? <ErrorState message={String(failed[1])} /> : (
          <EmptyState title="No purchases in this period" description={`No approved vendor bills dated between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}. Widen the period, or approve the bills waiting under Vendor bills.`} action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
        )}
      </Card>

      <div className="mn-ir-two">
        <Card
          title={<span className="mn-board-card-title"><Package size={16} aria-hidden /> By material <span className="mn-board-card-count">{register?.byMaterial?.length ?? 0}</span></span>}
          actions={<ExportButton rows={register?.byMaterial ?? []} columns={['material', 'quantity', 'taxable', 'tax', 'total']} filename="purchase-by-material" />}
          padded={false}
        >
          {!loaded ? (
            <TableSkeleton cols={3} />
          ) : register?.byMaterial?.length ? (
            <Table>
              <thead><tr><Th>Material</Th><Th numeric>Quantity</Th><Th numeric>Bought</Th></tr></thead>
              <tbody>
                {register.byMaterial.map((r, i) => (
                  <tr key={i}>
                    <Td><span className="mn-od-num">{String(r.material)}</span><span className="mn-od-rate-meta">{money(r.taxable)} + {money(r.tax)} GST</span></Td>
                    <Td numeric>{qty(r.quantity)}</Td>
                    <Td numeric>
                      {money(r.total)}
                      <span className="mn-od-linebar mn-pr-bar" aria-hidden><span style={{ width: `${registerTotal > 0 ? Math.max(4, (num(r.total) / registerTotal) * 100) : 0}%` }} /></span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : failed[1] ? <ErrorState message={String(failed[1])} /> : (
            <EmptyState title="No material lines" description="What the period's bills bought, by material." />
          )}
        </Card>

        <Card
          title={<span className="mn-board-card-title"><Store size={16} aria-hidden /> By supplier <span className="mn-board-card-count">{register?.byVendor?.length ?? 0}</span></span>}
          actions={<ExportButton rows={register?.byVendor ?? []} columns={['supplierName', 'gstin', 'billCount', 'taxable', 'tax', 'total']} filename="purchase-by-vendor" />}
          padded={false}
        >
          {!loaded ? (
            <TableSkeleton cols={3} />
          ) : register?.byVendor?.length ? (
            <Table>
              <thead><tr><Th>Supplier</Th><Th numeric>Bills</Th><Th numeric>Bought</Th></tr></thead>
              <tbody>
                {register.byVendor.map((r, i) => (
                  <tr key={i}>
                    <Td><span className="mn-od-num">{String(r.supplierName ?? 'Unknown')}</span><span className="mn-od-rate-meta">{money(r.taxable)} + {money(r.tax)} GST</span></Td>
                    <Td numeric>{String(r.billCount)}</Td>
                    <Td numeric>
                      {money(r.total)}
                      <span className="mn-od-linebar mn-pr-bar" aria-hidden><span style={{ width: `${registerTotal > 0 ? Math.max(4, (num(r.total) / registerTotal) * 100) : 0}%` }} /></span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : failed[1] ? <ErrorState message={String(failed[1])} /> : (
            <EmptyState title="No suppliers billed" description="What the period's bills came to, by supplier." />
          )}
          {topVendor && registerTotal > 0 && num(topVendor.total) / registerTotal > 0.5 ? <p className="mn-ir-foot">{String(topVendor.supplierName)} is {Math.round((num(topVendor.total) / registerTotal) * 100)}% of the period&rsquo;s buying; one supplier this large is worth a second quote now and then.</p> : null}
        </Card>
      </div>

      <Card
        title={<span className="mn-board-card-title"><BookOpen size={16} aria-hidden /> {ledger && supplierId ? `Account of ${ledger.supplierName || String(supplier?.supplierName ?? '')}` : 'A supplier\'s account'} {ledger ? <span className="mn-board-card-count">{ledger.rows.length}</span> : null}</span>}
        actions={
          <div className="mn-ir-tools">
            <label className="mn-cs-who mn-pr2-who">
              <Users size={14} aria-hidden />
              <Select value={supplierId} onChange={(e) => pick(e.target.value)} aria-label="Supplier">
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.supplierName)}</option>)}
              </Select>
            </label>
            {ledger && ledger.rows.length ? <ExportButton rows={ledger.rows} columns={['date', 'ref', 'particulars', 'debit', 'credit', 'balance']} filename={`vendor-ledger-${ledger.supplierName || 'supplier'}`} /> : null}
          </div>
        }
        padded={false}
      >
        {!supplierId ? failed[2] ? <ErrorState message={String(failed[2])} /> : (
          <EmptyState icon={<Users size={22} aria-hidden />} title="Pick a supplier" description="Their approved bills raise the balance, your payments lower it, in date order for the period above." />
        ) : busy && !ledger ? (
          <TableSkeleton cols={5} />
        ) : ledger && (ledger.rows.length || num(ledger.opening) !== 0) ? (
          <>
            <div className="mn-dc-wsum">
              <span>Brought forward <strong>{money(ledger.opening)}</strong></span>
              <span>Billed <strong className="mn-st-out">{money(ledger.totalDebit)}</strong></span>
              <span>Paid <strong className="mn-st-in">{money(ledger.totalCredit)}</strong></span>
              <span>Carried forward <strong>{money(ledger.closing)}</strong></span>
            </div>
            <div className="mn-id-scroll">
              <Table>
                <thead>
                  <tr><Th>Date</Th><Th>Entry</Th><Th numeric>Billed</Th><Th numeric>Paid</Th><Th numeric>Balance</Th></tr>
                </thead>
                <tbody>
                  <tr className="mn-cs-open">
                    <Td><span className="mn-ord-meta">{range.from ? formatDate(range.from) : 'Start'}</span></Td>
                    <Td><span className="mn-od-num">Balance brought forward</span></Td>
                    <Td /><Td />
                    <Td numeric><span className="mn-od-num">{money(ledger.opening)}</span></Td>
                  </tr>
                  {ledger.rows.map((r, i) => (
                    <tr key={i}>
                      <Td>{formatDate(r.date)}</Td>
                      <Td><span className="mn-cs-entry"><Badge tone={num(r.debit) ? 'warning' : 'success'}>{num(r.debit) ? 'Bill' : 'Payment'}</Badge> <span className="mn-od-num">{String(r.ref ?? '')}</span></span>{r.particulars && r.particulars !== r.ref ? <span className="mn-od-rate-meta">{String(r.particulars)}</span> : null}</Td>
                      <Td numeric>{num(r.debit) ? <span className="mn-st-out">{money(r.debit)}</span> : ''}</Td>
                      <Td numeric>{num(r.credit) ? <span className="mn-st-in">{money(r.credit)}</span> : ''}</Td>
                      <Td numeric><span className="mn-od-num">{money(r.balance)}</span></Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="mn-ir-total">
                    <Td><span className="mn-ord-meta">{range.to ? formatDate(range.to) : 'Today'}</span></Td>
                    <Td>Balance carried forward</Td>
                    <Td numeric>{money(ledger.totalDebit)}</Td>
                    <Td numeric>{money(ledger.totalCredit)}</Td>
                    <Td numeric><span className="mn-ir-total-value">{money(ledger.closing)}</span></Td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          </>
        ) : failed[2] ? <ErrorState message={String(failed[2])} /> : (
          <EmptyState title="Nothing in this period" description={`${String(supplier?.supplierName ?? 'This supplier')} had no approved bills or payments between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}, and nothing brought forward.`} action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
        )}
      </Card>
    </div>
  );
}
