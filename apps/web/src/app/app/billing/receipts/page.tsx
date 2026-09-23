'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CheckCircle2, Download, FileCheck2, FileText, Landmark, Plus, RefreshCw, Share2, Wallet, WalletCards } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { todayLocal } from '../../../../lib/report-range';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, customersApi, invoicesApi, openPdf, receiptsApi, type CustomerExposure, type Row, openWhatsAppShare } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Receipts — money in, and where it went.
 *
 * A stage strip (cheques pending / advances on account / cleared / reversed)
 * with live counts doubles as the filter, a summary pill totals what came in
 * on screen, and each receipt is one row: number and date, who paid and how,
 * the amount with what was applied and what is still on account, where the
 * cheque stands with the bank, the status, and the actions the state allows.
 * The "new receipt" form sits above the ledger: pick a customer (or arrive
 * from an invoice with the customer already picked), see their exposure,
 * spread the amount across open invoices oldest first, or hold it as an
 * advance. Same layout in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const money2 = (v: unknown) => '₹' + num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MODES: Array<{ value: string; label: string }> = [
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
];
const modeLabel = (m: unknown) => MODES.find((x) => x.value === String(m ?? ''))?.label ?? (m ? String(m).replace(/_/g, ' ') : '—');

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'pending', label: 'Cheques pending', tone: 'warning', hint: 'Cheques received but not yet cleared by the bank; not counted as paid until realised' },
  { key: 'advance', label: 'On account', tone: 'info', hint: 'Money received with nothing (or not everything) to apply it to yet; applied to the next invoice' },
  { key: 'cleared', label: 'Cleared', tone: 'success', hint: 'Received and fully applied' },
  { key: 'reversed', label: 'Reversed', tone: 'danger', hint: 'Bounced cheques and receipts reversed as keyed wrongly; every allocation was put back' },
];
const toneOf = (stage: string): Tone => STAGES.find((s) => s.key === stage)?.tone ?? 'neutral';
const labelOf = (stage: string) => STAGES.find((s) => s.key === stage)?.label.toLowerCase() ?? stage;

/** Which chip a receipt sits under right now. */
function stageOf(r: Row): string {
  if (String(r.status) === 'reversed') return 'reversed';
  if (String(r.clearingStatus ?? '') === 'pending') return 'pending';
  if (num(r.unallocatedAmount) > 0.001) return 'advance';
  return 'cleared';
}

/** Where the money stands, as the fourth column reads it. */
function standing(r: Row): { label: string; note: string; tone: Tone } {
  const stage = stageOf(r);
  const clearing = String(r.clearingStatus ?? '');
  if (stage === 'reversed') return clearing === 'bounced'
    ? { label: 'Cheque bounced', note: 'Allocations put back on the invoices', tone: 'danger' }
    : { label: 'Reversed', note: 'Allocations put back on the invoices', tone: 'danger' };
  if (stage === 'pending') return { label: 'Awaiting the bank', note: 'Press Realise once the cheque clears', tone: 'warning' };
  if (stage === 'advance') {
    const applied = num(r.allocatedAmount);
    return { label: `${money(r.unallocatedAmount)} on account`, note: applied > 0 ? `${money(applied)} applied so far` : 'Nothing to apply it to yet', tone: 'info' };
  }
  return { label: 'Applied in full', note: clearing === 'realised' ? 'Cheque cleared' : 'Nothing left on account', tone: 'success' };
}

export default function ReceiptsPage() {
  const { prompt, confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [openInvoices, setOpenInvoices] = useState<Row[]>([]);
  const [exposure, setExposure] = useState<CustomerExposure | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ amount: '', paymentMode: 'neft', receiptDate: todayLocal(), bankReference: '' });
  // A receipt is money-in: a double click or a retry after a lost response used
  // to post the same instrument twice. The API now refuses a repeated bank
  // reference (409); this stops the second submit from leaving the browser.
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [r, c] = await Promise.all([receiptsApi.list(win.limit), crud('customers').list()]);
    setRows(r);
    setCustomers(c);
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  const pickCustomer = useCallback(async (cid: string) => {
    setCustomerId(cid);
    setAlloc({});
    setError(null);
    setMsg(null);
    if (!cid) {
      setOpenInvoices([]);
      setExposure(null);
      return;
    }
    const [all, exp] = await Promise.all([
      invoicesApi.list('issued'),
      customersApi.exposure(cid).catch(() => null),
    ]);
    // Oldest first, so "fill oldest first" and the eye agree on the order.
    setOpenInvoices(
      all
        .filter((i) => i.customerId === cid && Number(i.outstandingAmount) > 0)
        .sort((a, b) => String(a.invoiceDate ?? '').localeCompare(String(b.invoiceDate ?? ''))),
    );
    setExposure(exp);
  }, []);

  // Arriving from an invoice ("Record receipt") lands with the customer picked.
  useEffect(() => {
    const cid = new URLSearchParams(window.location.search).get('customerId');
    if (cid) pickCustomer(cid).catch((e) => setError(String(e)));
  }, [pickCustomer]);

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

  /** Run a receipt action, then refresh and report — errors surface inline. */
  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  /** Spread the amount across the open invoices, oldest first, up to each one's outstanding. */
  function fillOldestFirst() {
    let left = num(form.amount);
    const next: Record<string, string> = {};
    for (const i of openInvoices) {
      if (left <= 0) break;
      const take = Math.min(left, num(i.outstandingAmount));
      if (take > 0) next[String(i.id)] = String(Math.round(take * 100) / 100);
      left -= take;
    }
    setAlloc(next);
  }

  async function create() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    const allocations = openInvoices
      .map((i) => ({ invoiceId: String(i.id), amount: Number(alloc[String(i.id)] || 0) }))
      .filter((a) => a.amount > 0);
    try {
      const r = await receiptsApi.create({
        customerId,
        amount: Number(form.amount || 0),
        paymentMode: form.paymentMode,
        receiptDate: form.receiptDate || undefined,
        bankReference: form.bankReference || undefined,
        allocations,
      });
      const held = num(r.unallocatedAmount);
      setMsg(`Receipt ${String(r.receiptNo)} recorded: ${money2(r.allocatedAmount)} applied${held > 0 ? `, ${money2(held)} held on account` : ''}.`);
      setForm({ amount: '', paymentMode: 'neft', receiptDate: todayLocal(), bankReference: '' });
      setCustomerId('');
      setOpenInvoices([]);
      setExposure(null);
      setAlloc({});
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (filter ? rows.filter((r) => stageOf(r) === filter) : rows), [rows, filter]);
  const received = useMemo(() => shown.reduce((t, r) => (stageOf(r) === 'reversed' ? t : t + num(r.amount)), 0), [shown]);
  const pending = useMemo(() => {
    const list = rows.filter((r) => stageOf(r) === 'pending');
    return { count: list.length, amount: list.reduce((t, r) => t + num(r.amount), 0) };
  }, [rows]);
  const onAccount = useMemo(() => {
    const list = rows.filter((r) => stageOf(r) === 'advance');
    return { count: list.length, amount: list.reduce((t, r) => t + num(r.unallocatedAmount), 0) };
  }, [rows]);
  const allocated = useMemo(() => Object.values(alloc).reduce((t, v) => t + num(v), 0), [alloc]);
  const amount = num(form.amount);
  const pickedCustomer = customers.find((c) => String(c.id) === customerId);

  return (
    <div className="mn-ord mn-rc">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Receipts</h1>
          <p>Every rupee a customer pays, recorded once and applied to their open invoices. A cheque counts only after the bank clears it; money with nothing to apply to waits on account for the next invoice.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Wallet size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'receipt' : 'receipts'}
            {' · '}
            {moneyShort(received)} received
          </span>
          <Link href="/app/billing/outstanding" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<BookOpen size={14} />}>Outstanding</Button>
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

      {(pending.count > 0 || onAccount.count > 0) && !filter && (
        <div className="mn-ord-notes">
          {pending.count > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('pending')}>
              <Landmark size={16} aria-hidden />
              <span>
                <strong>{money(pending.amount)} in {pending.count} {pending.count === 1 ? 'cheque is' : 'cheques are'} waiting on the bank.</strong>{' '}
                Press Realise on each one once it clears; until then the invoices stay unpaid.
              </span>
            </button>
          )}
          {onAccount.count > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--btn" onClick={() => setFilter('advance')}>
              <WalletCards size={16} aria-hidden />
              <span>
                <strong>{money(onAccount.amount)} is on account across {onAccount.count} {onAccount.count === 1 ? 'receipt' : 'receipts'}.</strong>{' '}
                Press Apply advance on a receipt once its customer has an issued invoice.
              </span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><FileCheck2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New receipt</span>}>
        <div className="mn-rc-form">
          <Field label="Customer">
            <select className="mn-input" value={customerId} onChange={(e) => pickCustomer(e.target.value).catch((err) => setError(String(err)))}>
              <option value="">— select —</option>
              {customers.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>{String(c.customerName)}</option>
              ))}
            </select>
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" step="any" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Mode">
            <select className="mn-input" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })} />
          </Field>
          <Field label={form.paymentMode === 'cheque' ? 'Cheque no' : form.paymentMode === 'cash' ? 'Reference (optional)' : 'Bank reference'}>
            <Input value={form.bankReference} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} placeholder={form.paymentMode === 'cheque' ? 'Cheque number' : 'UTR / transaction id'} />
          </Field>
        </div>

        {!customerId && (
          <p className="mn-board-form-hint">Pick the customer who paid. Their open invoices appear here, oldest first, so the money can be applied where it belongs.</p>
        )}

        {customerId && exposure && (
          <div className="mn-od-credit-grid mn-rc-exposure">
            <StatCard label="Exposure" value={money(exposure.exposure)} tone="info" />
            <StatCard label="Invoices outstanding" value={money(exposure.invoiceOutstanding)} tone={exposure.invoiceOutstanding > 0 ? 'warning' : 'neutral'} />
            <StatCard label="Advance on account" value={money(exposure.advanceCredit)} tone={exposure.advanceCredit > 0 ? 'success' : 'neutral'} />
            <StatCard
              label="Available credit"
              value={exposure.availableCredit === null ? 'No limit' : money(exposure.availableCredit)}
              tone={exposure.availableCredit !== null && exposure.availableCredit < 0 ? 'danger' : 'neutral'}
            />
          </div>
        )}

        {customerId &&
          (openInvoices.length ? (
            <div className="mn-rc-alloc">
              <div className="mn-rc-alloc-head">
                <span className="mn-ord-meta">
                  {openInvoices.length} open {openInvoices.length === 1 ? 'invoice' : 'invoices'} for {String(pickedCustomer?.customerName ?? 'this customer')}, oldest first. Type what to apply to each, or let the amount fill them in order.
                </span>
                <Button variant="secondary" size="sm" onClick={fillOldestFirst} disabled={amount <= 0}>Fill oldest first</Button>
              </div>
              <div className="mn-id-scroll">
                <Table>
                  <thead>
                    <tr>
                      <Th>Invoice</Th>
                      <Th>Due</Th>
                      <Th numeric>Total</Th>
                      <Th numeric>Outstanding</Th>
                      <Th numeric>Apply</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((i) => (
                      <tr key={String(i.id)}>
                        <Td><Link href={`/app/billing/invoices/${String(i.id)}`} className="mn-id-link">{String(i.invoiceNo)}</Link><span className="mn-od-rate-meta">{formatDate(i.invoiceDate)}</span></Td>
                        <Td>{i.dueDate ? formatDate(i.dueDate) : '—'}</Td>
                        <Td numeric className="mn-od-num">{money2(i.totalAmount)}</Td>
                        <Td numeric className="mn-od-num">{money2(i.outstandingAmount)}</Td>
                        <Td numeric>
                          <Input type="number" step="any" inputMode="decimal" style={{ width: 130, textAlign: 'right' }} value={alloc[String(i.id)] ?? ''} onChange={(e) => setAlloc({ ...alloc, [String(i.id)]: e.target.value })} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <p className="mn-board-form-hint mn-rc-alloc-sum" data-tone={allocated > amount + 0.001 ? 'danger' : 'neutral'}>
                {allocated > amount + 0.001
                  ? `Applying ${money2(allocated)} but the receipt is only ${money2(amount)}. Reduce the allocations.`
                  : amount > 0 && allocated < amount - 0.001
                    ? `${money2(allocated)} applied; ${money2(amount - allocated)} will be held as an advance on account.`
                    : amount > 0
                      ? `${money2(allocated)} applied; nothing left on account.`
                      : 'Enter the amount received first.'}
              </p>
            </div>
          ) : (
            // An advance — money before the first pour — is the normal first
            // receipt from a new customer. It used to be unrecordable here:
            // the button lived inside this branch, so a customer with nothing
            // outstanding had no way to pay.
            <p className="mn-board-form-hint">
              No outstanding invoices for this customer. The receipt will be held as an advance on account and applied when an invoice is issued.
            </p>
          ))}
        {customerId && (
          <div className="mn-rc-submit">
            <Button disabled={saving || amount <= 0 || allocated > amount + 0.001} loading={saving} onClick={create} icon={<CheckCircle2 size={14} />}>Record receipt</Button>
            <Button variant="ghost" onClick={() => pickCustomer('')}>Clear</Button>
          </div>
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Receipts ledger <span className="mn-board-card-count">{shown.length}</span></span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Receipt</span>
              <span>Customer · mode</span>
              <span className="is-num">Amount</span>
              <span>Where it stands</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const st = standing(r);
              const id = String(r.id);
              const no = String(r.receiptNo ?? '');
              const reversed = stage === 'reversed';
              const clearing = String(r.clearingStatus ?? '');
              const isCheque = String(r.paymentMode ?? '') === 'cheque';
              const canBounce = !reversed && isCheque && (clearing === 'pending' || clearing === 'realised');
              const canApply = !reversed && num(r.unallocatedAmount) > 0;
              return (
                <div key={id} className={`mn-ord-row mn-ord-row--acts${reversed ? ' is-void' : ''}`} data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{no}</span>
                    <span className="mn-ord-meta">{formatDate(r.receiptDate)}{r.isAdvance ? <><span className="mn-ord-dot" aria-hidden>·</span>Advance</> : null}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">
                      {modeLabel(r.paymentMode)}
                      {r.bankReference ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.bankReference)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.amount)}</span>
                    <span className="mn-ord-meta">{money(r.allocatedAmount)} applied{num(r.unallocatedAmount) > 0.001 ? ` · ${money(r.unallocatedAmount)} on account` : ''}</span>
                  </div>
                  <div className="mn-ord-when" data-tone={st.tone}>
                    <span className="mn-ord-when-d">{st.label}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{st.note}</span>
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={reversed ? String(r.status) : clearing || String(r.status ?? '')} />
                    {clearing === 'bounced' && <Badge tone="danger">bounced</Badge>}
                  </div>
                  <div className="mn-ord-go mn-rc-acts">
                    <Button variant="ghost" size="sm" icon={<Download size={14} />} aria-label={`Print ${no}`} onClick={() => openPdf(`/receipts/${String(r.id)}/pdf`, String(r.receiptNo ?? '')).catch((e) => setError(String(e)))}>
                      Print
                    </Button>
                    {clearing === 'pending' && (
                      <Button size="sm" onClick={() => act(() => receiptsApi.realise(id), `Receipt ${no} marked realised.`)}>
                        Realise
                      </Button>
                    )}
                    {canApply && (
                      <Button variant="secondary" size="sm" onClick={() => act(() => receiptsApi.apply(id), `Applied the advance on ${no}.`)}>
                        Apply advance
                      </Button>
                    )}
                    {canBounce && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          act(async () => {
                            if (!(await confirm({ title: 'Bounce cheque', message: `Reverse receipt ${no}? Every allocation is restored to its invoice.`, confirmLabel: 'Bounce' }))) return;
                            const reason = await prompt({ title: 'Bounce cheque', label: 'Reason', defaultValue: '' });
                            if (reason === null) return;
                            await receiptsApi.bounce(id, reason);
                          }, `Receipt ${no} reversed.`)
                        }
                      >
                        Bounce
                      </Button>
                    )}
                    {!reversed && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          act(async () => {
                            if (!(await confirm({ title: 'Reverse receipt', message: `Reverse receipt ${no}? Every allocation is restored to its invoice and the receipt leaves the customer ledger. For a cheque returned by the bank use Bounce instead.`, confirmLabel: 'Reverse' }))) return;
                            const reason = await prompt({ title: 'Reverse receipt', label: 'Reason (wrong invoice, wrong amount, duplicate…)', defaultValue: '' });
                            if (reason === null) return;
                            await receiptsApi.reverse(id, reason);
                          }, `Receipt ${no} reversed.`)
                        }
                      >
                        Reverse
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Share2 size={14} />}
                      aria-label={`Share ${no} on WhatsApp`}
                      onClick={async () => {
                        const m = await prompt({ title: 'Share receipt', label: 'Recipient mobile', defaultValue: '' });
                        if (m === null) return;
                        setError(null);
                        try {
                          setMsg(await openWhatsAppShare(() => receiptsApi.share(id, m)));
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} receipts` : 'No receipts yet'}
            description={filter ? 'Nothing at this stage right now. Press the chip again to see every receipt.' : 'Record the first customer payment above. It is applied to their open invoices, or held on account until one is issued.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all receipts</Button> : undefined}
          />
        )}
        <ListCap shown={shown.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="receipts" hint="the receipts register (Billing → Reports)" />
      </Card>
    </div>
  );
}
