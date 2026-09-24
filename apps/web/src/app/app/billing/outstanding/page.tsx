'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookOpen, FileText, Landmark, RefreshCw, Users, Wallet } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { billingReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { ExportButton } from '../../../../components/ExportButton';
import { TemplateButton } from '../../../../components/TemplateButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Customer outstanding — who owes what, and for how long.
 *
 * Five tiles sum the receivables up (owed, overdue, older than 90 days,
 * uncleared cheques, customers owing); notes name the money that has aged
 * past 90 days and the cheques still in transit; an age strip (current /
 * 31–60 / 61–90 / 90+) with live totals doubles as the filter; and each
 * customer is one row: who and how to reach them, the age of their money as
 * a bar split by bucket with the oldest invoice, what they owe with the
 * overdue part, their exposure against the limit, when they last paid, and
 * Reminder / Statement / Record receipt. Worst age sorts first. Same layout
 * in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const BUCKETS: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'b0_30', label: 'Up to 30 days', tone: 'success', hint: 'Invoiced within the last month' },
  { key: 'b31_60', label: '31–60 days', tone: 'info', hint: 'One to two months old' },
  { key: 'b61_90', label: '61–90 days', tone: 'warning', hint: 'Two to three months old; chase now' },
  { key: 'b90', label: 'Over 90 days', tone: 'danger', hint: 'Older than three months; at risk' },
];
/** The oldest bucket a customer has money in. */
function worstOf(r: Row): string {
  for (const b of [...BUCKETS].reverse()) if (num(r[b.key]) > 0.001) return b.key;
  return 'b0_30';
}
const toneOf = (key: string): Tone => BUCKETS.find((b) => b.key === key)?.tone ?? 'neutral';
const labelOf = (key: string) => BUCKETS.find((b) => b.key === key)?.label.toLowerCase() ?? key;

/** Days since a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysSince(date: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - d.getTime()) / 86_400_000);
}

export default function OutstandingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const d = await billingReportsApi.outstanding();
    setRows(d.rows as Row[]);
    setTotals(d.totals as Row);
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

  const shown = useMemo(() => {
    const list = filter ? rows.filter((r) => num(r[filter]) > 0.001) : rows;
    // Oldest money first, then the biggest total.
    const rank = (r: Row) => BUCKETS.findIndex((b) => b.key === worstOf(r));
    return [...list].sort((a, b) => rank(b) - rank(a) || num(b.total) - num(a.total));
  }, [rows, filter]);
  const shownTotal = shown.reduce((t, r) => t + num(r.total), 0);
  const over90 = rows.filter((r) => num(r.b90) > 0.001);
  const uncleared = num(totals?.unclearedCheques);
  const exposureTotal = rows.reduce((t, r) => t + num(r.exposure), 0);

  return (
    <div className="mn-ord mn-ao">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Customer outstanding</h1>
          <p>What each customer owes on issued invoices and how old that money is. The buckets go by invoice date; overdue means past the due date. Exposure is the fuller picture the credit gate uses: it also counts confirmed orders not yet invoiced and nets off advances.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Wallet size={14} aria-hidden />
            {loaded ? `${shown.length} ${shown.length === 1 ? 'customer owes' : 'customers owe'} ${moneyShort(shownTotal)}` : 'Loading…'}
          </span>
          <Link href="/app/billing/receipts" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<Landmark size={14} />}>Record a receipt</Button>
          </Link>
          <Link href="/app/billing/invoices" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<FileText size={14} />}>Invoices</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {loaded && (over90.length > 0 || uncleared > 0) && (
        <div className="mn-ord-notes">
          {over90.length > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter('b90')}>
              <AlertTriangle size={16} aria-hidden />
              <span>
                <strong>{moneyShort(num(totals?.b90))} has been owed for more than 90 days by {over90.length} {over90.length === 1 ? 'customer' : 'customers'}: {over90.slice(0, 3).map((r) => String(r.customerName)).join(', ')}{over90.length > 3 ? ` and ${over90.length - 3} more` : ''}.</strong>{' '}
                Money this old is at risk; call them today and hold new orders until it moves.
              </span>
            </button>
          )}
          {uncleared > 0 && (
            <Link className="mn-ord-note mn-ord-note--warn" href="/app/billing/receipts">
              <Landmark size={16} aria-hidden />
              <span>
                <strong>{moneyShort(uncleared)} of the collections behind these figures is cheques the bank has not cleared yet.</strong>{' '}
                They are already taken off the outstanding, and can still bounce; realise them under Receipts once they clear.
              </span>
            </Link>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Owed" value={loaded ? moneyShort(num(totals?.total)) : '—'} tone="info" />
        <StatCard label="Overdue" value={loaded ? moneyShort(num(totals?.overdue)) : '—'} tone={num(totals?.overdue) > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Over 90 days" value={loaded ? moneyShort(num(totals?.b90)) : '—'} tone={num(totals?.b90) > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Uncleared cheques" value={loaded ? moneyShort(uncleared) : '—'} tone={uncleared > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Customers owing" value={loaded ? String(rows.length) : '—'} />
      </div>

      {/* Age strip — totals per bucket; press one to show the customers with money that old. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by the age of the money">
        {BUCKETS.map((b) => {
          const v = num(totals?.[b.key]);
          const on = filter === b.key;
          return (
            <button
              key={b.key}
              type="button"
              className={`mn-board-chip mn-ao-chip${on ? ' is-on' : ''}${v <= 0.001 ? ' is-empty' : ''}`}
              data-tone={b.tone}
              aria-pressed={on}
              title={b.hint}
              onClick={() => setFilter(on ? '' : b.key)}
            >
              <span className="mn-board-chip-n">{loaded ? moneyShort(v) : '—'}</span>
              <span className="mn-board-chip-l">{b.label}</span>
            </button>
          );
        })}
        {filter && (
          <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>
            Show all
          </button>
        )}
      </div>

      <Card
        title={<span className="mn-board-card-title"><Users size={16} aria-hidden /> By customer <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">Oldest money first.</span>
            <ExportButton rows={shown} columns={['customerName', 'contactPerson', 'mobile', 'invoiceCount', 'b0_30', 'b31_60', 'b61_90', 'b90', 'total', 'overdue', 'exposure', 'creditLimit', 'lastReceiptDate']} filename="customer-outstanding" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Customer</span>
              <span>Age of the money</span>
              <span className="is-num">Owed</span>
              <span>Exposure</span>
              <span>Last paid</span>
              <span />
            </div>
            {shown.map((r) => {
              const worst = worstOf(r);
              const total = num(r.total);
              const limit = num(r.creditLimit);
              const exposure = num(r.exposure);
              const pct = limit > 0 ? (exposure / limit) * 100 : null;
              const overLimit = limit > 0 && exposure > limit;
              const since = daysSince(r.lastReceiptDate);
              const contact = [r.contactPerson, r.mobile].filter(Boolean).map(String).join(' · ');
              const segs = BUCKETS.map((b) => ({ ...b, amount: num(r[b.key]), pct: total > 0 ? (num(r[b.key]) / total) * 100 : 0 })).filter((s) => s.amount > 0.001);
              return (
                <div key={String(r.customerId ?? r.customerName)} className="mn-ord-row mn-ord-row--acts mn-ao-row" data-tone={toneOf(worst)} role="listitem">
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">{contact || 'No contact on file'}</span>
                    <span className="mn-ord-meta">{num(r.invoiceCount)} open {num(r.invoiceCount) === 1 ? 'invoice' : 'invoices'}{num(r.creditDays) > 0 ? ` · ${num(r.creditDays)} days credit` : ''}</span>
                  </div>
                  <div className="mn-ao-age">
                    <span className="mn-ao-bar" role="img" aria-label={segs.map((s) => `${s.label}: ${money(s.amount)}`).join(', ')}>
                      {segs.map((s) => <span key={s.key} data-tone={s.tone} style={{ width: `${s.pct}%` }} title={`${s.label}: ${money(s.amount)}`} />)}
                    </span>
                    <span className="mn-ord-meta mn-ao-age-text">
                      {segs.map((s, i) => <span key={s.key} data-tone={s.tone}>{i > 0 ? ' · ' : ''}{moneyShort(s.amount)} <em>{s.label.replace('Up to 30 days', '≤30 d').replace(' days', ' d').replace('Over 90 d', '>90 d')}</em></span>)}
                      {num(r.oldestDays) > 0 ? <><span className="mn-ord-dot" aria-hidden>·</span>oldest {num(r.oldestDays)} d</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(total)}</span>
                    <span className={`mn-ord-meta${num(r.overdue) > 0.001 ? ' mn-ao-overdue' : ''}`}>{num(r.overdue) > 0.001 ? `${moneyShort(num(r.overdue))} past due` : 'Nothing past due yet'}</span>
                  </div>
                  <div className="mn-ao-exposure" data-tone={overLimit ? 'danger' : pct != null && pct >= 80 ? 'warning' : 'neutral'}>
                    <span className="mn-ord-when-d">{money(exposure)}</span>
                    <span className="mn-ord-meta mn-ao-exposure-text">
                      {limit > 0 ? (overLimit ? `${moneyShort(exposure - limit)} over the ${moneyShort(limit)} limit` : `${Math.round(pct ?? 0)}% of the ${moneyShort(limit)} limit`) : 'No credit limit set'}
                    </span>
                  </div>
                  <div className="mn-ord-when" data-tone={since == null ? 'warning' : since > 60 ? 'danger' : since > 30 ? 'warning' : 'neutral'}>
                    <span className="mn-ord-when-d">{r.lastReceiptDate ? formatDate(r.lastReceiptDate) : 'Never'}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{since == null ? 'No receipt on record' : `${moneyShort(num(r.lastReceiptAmount))} · ${since === 0 ? 'today' : `${since} ${since === 1 ? 'day' : 'days'} ago`}`}</span>
                  </div>
                  <div className="mn-ord-act mn-ao-acts">
                    <TemplateButton
                      // Lead with the firmer wording once anything has aged past 60 days.
                      templateKeys={num(r.b61_90) + num(r.b90) > 0 ? ['payment_reminder_overdue', 'payment_reminder'] : ['payment_reminder', 'payment_reminder_overdue']}
                      title="Payment reminder"
                      label="Reminder"
                      mobile={r.mobile}
                      context={{ customerName: r.customerName, contactPerson: r.contactPerson, amount: money(total), outstanding: money(total) }}
                    />
                    {r.customerId ? <Link href={`/app/billing/statement?customerId=${String(r.customerId)}`} className="mn-ord-link"><Button size="sm" variant="ghost" icon={<BookOpen size={14} />}>Statement</Button></Link> : null}
                    {r.customerId ? <Link href={`/app/billing/receipts?customerId=${String(r.customerId)}`} className="mn-ord-link"><Button size="sm" variant="ghost" icon={<Landmark size={14} />}>Receipt</Button></Link> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : filter ? (
          <EmptyState title={`Nothing owed ${labelOf(filter)}`} description="Press the chip again to see every customer who owes money." action={<Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button>} />
        ) : (
          <EmptyState title="Nothing outstanding" description="Every issued invoice has been paid, credited or written off. A customer appears here as soon as an issued invoice carries a balance." />
        )}
        <p className="mn-ir-foot">Owed is the balance on issued invoices; the age is counted from the invoice date. Exposure adds confirmed orders not yet invoiced and the opening balance, and nets off advances: it totals {money(exposureTotal)} across these customers and is the figure the credit gate checks.</p>
      </Card>
    </div>
  );
}
