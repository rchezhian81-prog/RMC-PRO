'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CalendarRange, Download, FileText, Landmark, Users, Wallet } from 'lucide-react';
import { currentMonthRange, financialYearRange, todayLocal } from '../../../../lib/report-range';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { crud, billingReportsApi, type CustomerStatement, type Row, openPdf } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Input, Select } from '../../../../components/ui/Field';
import { Button } from '../../../../components/ui/Button';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Customer statement — one customer's ledger for a period.
 *
 * Pick the customer (or arrive with ?customerId= from the outstanding
 * screen), pick the period from the chips (this month, last month, this
 * financial year, all time) or any two dates, and read the account: four
 * tiles (opening, billed, received, closing), then every invoice, receipt
 * and note in date order with a running balance, an opening line at the top
 * and a closing line at the bottom, with Print and CSV. Same layout in both
 * skins; every colour reads the semantic tokens.
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

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const TYPES: Record<string, { label: string; tone: Tone }> = {
  invoice: { label: 'Invoice', tone: 'info' },
  debit_note: { label: 'Debit note', tone: 'warning' },
  receipt: { label: 'Receipt', tone: 'success' },
  credit_note: { label: 'Credit note', tone: 'success' },
  bill: { label: 'Bill', tone: 'info' },
  payment: { label: 'Payment', tone: 'success' },
};

export default function CustomerStatementPage() {
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  // A statement of account is a period document: it opens on this month.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [stmt, setStmt] = useState<CustomerStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (cid: string, r: Range) => {
    if (!cid) {
      setStmt(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setStmt(await billingReportsApi.customerStatement(cid, r.from || undefined, r.to || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the statement');
      setStmt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // The customer list, and the customer named in the URL (a link from the
  // outstanding screen or a customer row) opens straight away.
  useEffect(() => {
    crud('customers').list().then(setCustomers).catch((e) => setError(String(e)));
    if (typeof window === 'undefined') return;
    const cid = new URLSearchParams(window.location.search).get('customerId');
    if (cid) {
      setCustomerId(cid);
      load(cid, currentMonthRange()).catch((e) => setError(String(e)));
    }
  }, [load]);

  function pick(cid: string) {
    setCustomerId(cid);
    load(cid, range).catch((e) => setError(String(e)));
  }
  function apply(r: Range) {
    setRange(r);
    setDraft(r);
    load(customerId, r).catch((e) => setError(String(e)));
  }

  const now = new Date();
  const activePreset = PRESETS.find((p) => {
    const r = p.range(now);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;
  const periodLabel = range.from || range.to ? `${range.from ? formatDate(range.from) : 'the start'} → ${range.to ? formatDate(range.to) : 'today'}` : 'all time';
  const customer = customers.find((c) => String(c.id) === customerId);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stmt?.rows ?? []) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [stmt]);

  // Flatten to CSV rows with the opening line first, so the export mirrors the table.
  const exportRows = stmt
    ? [
        { date: '', type: '', particulars: 'Opening balance', ref: '', debit: '', credit: '', balance: stmt.opening },
        ...stmt.rows.map((r) => ({ date: r.date ?? '', type: r.type, particulars: r.particulars, ref: r.ref, debit: r.debit || '', credit: r.credit || '', balance: r.balance })),
      ]
    : [];
  const hasRows = !!stmt && (stmt.rows.length > 0 || num(stmt.opening) !== 0);

  return (
    <div className="mn-ord mn-cs">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Customer statement</h1>
          <p>One customer&rsquo;s account for a period: the balance brought forward, every invoice and note that added to it and every receipt that reduced it, in date order, and the balance carried forward. Print it for the customer or send it with a reminder.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <BookOpen size={14} aria-hidden />
            {stmt && customerId ? `Closing ${moneyShort(stmt.closing)}${num(stmt.closing) > 0 ? ' owed' : num(stmt.closing) < 0 ? ' in advance' : ''}` : 'Pick a customer'}
          </span>
          <Link href="/app/billing/outstanding" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<Wallet size={14} />}>Outstanding</Button>
          </Link>
          {customerId ? (
            <Link href={`/app/billing/receipts?customerId=${customerId}`} className="mn-ord-link">
              <Button variant="ghost" size="sm" icon={<Landmark size={14} />}>Record a receipt</Button>
            </Link>
          ) : null}
        </div>
      </header>

      {error && <ErrorState message={error} />}

      {/* Who and when: the customer, then the quick windows as chips or any two dates. */}
      <div className="mn-dr-period mn-cs-period" role="group" aria-label="Customer and period">
        <label className="mn-cs-who">
          <Users size={14} aria-hidden />
          <Select value={customerId} onChange={(e) => pick(e.target.value)} aria-label="Customer">
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>{String(c.customerName)}{c.customerCode ? ` · ${String(c.customerCode)}` : ''}</option>
            ))}
          </Select>
        </label>
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
          <Button type="submit" variant="secondary" size="sm" disabled={loading || (draft.from === range.from && draft.to === range.to)}>Apply</Button>
        </form>
      </div>

      {stmt && customerId && (
        <div className="mn-od-kpis mn-cs-kpis">
          <StatCard label="Brought forward" value={money(stmt.opening)} tone={num(stmt.opening) > 0 ? 'warning' : 'neutral'} />
          <StatCard label="Billed in the period" value={money(stmt.totalDebit)} tone="info" />
          <StatCard label="Received in the period" value={money(stmt.totalCredit)} tone={num(stmt.totalCredit) > 0 ? 'success' : 'neutral'} />
          <StatCard label="Carried forward" value={money(stmt.closing)} tone={num(stmt.closing) > 0 ? 'warning' : num(stmt.closing) < 0 ? 'success' : 'neutral'} />
        </div>
      )}

      <Card
        title={<span className="mn-board-card-title"><BookOpen size={16} aria-hidden /> {stmt && customerId ? `Account of ${stmt.customerName || String(customer?.customerName ?? '')}` : 'Account'} {stmt ? <span className="mn-board-card-count">{stmt.rows.length}</span> : null}</span>}
        actions={
          hasRows ? (
            <div className="mn-ir-tools">
              <span className="mn-ord-how">{periodLabel}</span>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={15} />}
                onClick={() => openPdf(`/billing-reports/customer-statement/pdf?customerId=${encodeURIComponent(customerId)}${range.from ? `&from=${range.from}` : ''}${range.to ? `&to=${range.to}` : ''}`, `Statement - ${stmt?.customerName ?? 'customer'}`).catch((e) => setError(String(e)))}
              >
                Print statement
              </Button>
              <ExportButton rows={exportRows} columns={['date', 'type', 'particulars', 'ref', 'debit', 'credit', 'balance']} filename="customer-statement" />
            </div>
          ) : null
        }
        padded={false}
      >
        {loading ? (
          <TableSkeleton cols={6} />
        ) : !customerId ? (
          <EmptyState icon={<Users size={22} aria-hidden />} title="Pick a customer" description="Choose the customer above to see their account for the period. Arriving from Customer outstanding opens it straight away." />
        ) : hasRows ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Entry</Th>
                  <Th numeric>Billed</Th>
                  <Th numeric>Received</Th>
                  <Th numeric>Balance</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="mn-cs-open">
                  <Td><span className="mn-ord-meta">{range.from ? formatDate(range.from) : 'Start'}</span></Td>
                  <Td><span className="mn-od-num">Balance brought forward</span><span className="mn-od-rate-meta">{num(stmt!.opening) > 0 ? 'owed before the period began' : num(stmt!.opening) < 0 ? 'held in advance before the period began' : 'nothing owed before the period began'}</span></Td>
                  <Td /><Td />
                  <Td numeric><span className="mn-od-num">{money(stmt!.opening)}</span></Td>
                </tr>
                {stmt!.rows.map((r, i) => {
                  const t = TYPES[r.type] ?? { label: r.type.replace(/_/g, ' '), tone: 'neutral' as Tone };
                  return (
                    <tr key={i}>
                      <Td>{r.date ? formatDate(r.date) : '—'}</Td>
                      <Td>
                        <span className="mn-cs-entry"><Badge tone={t.tone}>{t.label}</Badge> <span className="mn-od-num">{r.ref || r.particulars}</span></span>
                        {r.ref && r.particulars && r.particulars !== r.ref ? <span className="mn-od-rate-meta">{r.particulars}</span> : null}
                      </Td>
                      <Td numeric>{r.debit ? <span className="mn-st-out">{money(r.debit)}</span> : ''}</Td>
                      <Td numeric>{r.credit ? <span className="mn-st-in">{money(r.credit)}</span> : ''}</Td>
                      <Td numeric><span className={`mn-od-num${num(r.balance) < 0 ? ' mn-st-in' : ''}`}>{money(r.balance)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td><span className="mn-ord-meta">{range.to ? formatDate(range.to) : 'Today'}</span></Td>
                  <Td>Balance carried forward{counts.size ? ` · ${[...counts.entries()].map(([k, n]) => `${n} ${(TYPES[k]?.label ?? k).toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')}` : ''}</Td>
                  <Td numeric>{money(stmt!.totalDebit)}</Td>
                  <Td numeric>{money(stmt!.totalCredit)}</Td>
                  <Td numeric><span className="mn-ir-total-value">{money(stmt!.closing)}</span></Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : (
          <EmptyState icon={<FileText size={22} aria-hidden />} title="Nothing in this period" description={`${String(customer?.customerName ?? 'This customer')} had no invoices, notes or receipts between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}, and no balance brought forward. Widen the period.`} action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
        )}
        {hasRows ? <p className="mn-ir-foot">Billed is invoices and debit notes; received is receipts and credit notes. A positive balance is what the customer owes; a negative one is money held in advance.</p> : null}
      </Card>
    </div>
  );
}
