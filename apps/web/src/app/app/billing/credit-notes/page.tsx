'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, FileText, Hourglass, Receipt, RefreshCw, Share2, XCircle } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { creditNotesApi, openPdf, openWhatsAppShare, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Credit and debit notes — what changed on an invoice after it was issued.
 *
 * A stage strip (draft / issued / cancelled) with live counts doubles as the
 * filter, a summary pill nets the credits and debits on screen, a note
 * counts the drafts waiting to be issued, and each note is one row: number
 * and date with its kind, the invoice it amends (linked) with the party, the
 * reason in words with any remarks, the amount with its tax, the status,
 * and Print / Share / Issue / Cancel as the state allows. A note is raised
 * from the invoice itself; this screen lists and issues them. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'warning', hint: 'Prepared, not yet numbered; the invoice balance is unchanged until it is issued' },
  { key: 'issued', label: 'Issued', tone: 'success', hint: 'Numbered and applied to the invoice; reported in GSTR-1 table 9B' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Reversed; the number stays used, as GST requires' },
];
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;
const kindOf = (r: Row) => (String(r.noteType) === 'debit' ? 'Debit note' : 'Credit note');

export default function CreditNotesPage() {
  const { confirm, prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();
  const canApprove = getAccess().has('invoice_cancellation.approve');

  const reload = useCallback(async () => {
    setRows(await creditNotesApi.list(undefined, win.limit));
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

  async function act(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const out = await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.status), (m.get(String(r.status)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = filter ? rows.filter((r) => String(r.status) === filter) : rows;
  const net = useMemo(() => shown.filter((r) => String(r.status) === 'issued').reduce((t, r) => t + (String(r.noteType) === 'debit' ? 1 : -1) * num(r.totalAmount), 0), [shown]);
  const drafts = counts.get('draft') ?? 0;

  return (
    <div className="mn-ord mn-cn">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Credit and debit notes</h1>
          <p>A credit note cuts what a customer owes on an issued invoice: a rate agreed lower, concrete short-supplied or returned, a discount after the fact. A debit note adds to it. Raise one from the invoice; issue it here so it takes a number and moves the balance.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Receipt size={14} aria-hidden />
            {loaded ? `${shown.length} ${filter ? labelOf(filter) : ''} ${shown.length === 1 ? 'note' : 'notes'}${net !== 0 ? ` · ${net < 0 ? '−' : '+'}${moneyShort(Math.abs(net))} net` : ''}` : 'Loading…'}
          </span>
          <Link href="/app/billing/invoices" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<FileText size={14} />}>Invoices</Button>
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

      {loaded && drafts > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('draft')}>
            <Hourglass size={16} aria-hidden />
            <span><strong>{drafts} {drafts === 1 ? 'note is' : 'notes are'} still a draft.</strong> A draft changes nothing: the invoice balance and the GST return move only when it is issued.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card
        title={<span className="mn-board-card-title"><Receipt size={16} aria-hidden /> Notes <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Raise a note from Billing › Invoices › open the invoice.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Note</span>
              <span>Against</span>
              <span>Why</span>
              <span className="is-num">Amount</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const status = String(r.status);
              const id = String(r.id);
              const no = String(r.noteNo ?? '');
              const debit = String(r.noteType) === 'debit';
              const tax = num(r.cgstAmount) + num(r.sgstAmount) + num(r.igstAmount) + num(r.cessAmount);
              return (
                <div key={id} className={`mn-ord-row mn-ord-row--acts mn-cn-row${status === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(status)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{no || <span className="mn-cn-draft">Draft {kindOf(r).toLowerCase()}</span>}</span>
                    <span className="mn-ord-meta">{formatDate(r.noteDate ?? r.createdAt)}<span className="mn-ord-dot" aria-hidden>·</span>{kindOf(r)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <Link href={`/app/billing/invoices/${String(r.invoiceId)}`} className="mn-ord-cust mn-id-link">{r.invoiceNo ? String(r.invoiceNo) : 'the invoice'}</Link>
                    <span className="mn-ord-meta">{String(r.customerName ?? '—')}{r.invoiceTotal != null ? <><span className="mn-ord-dot" aria-hidden>·</span>billed {moneyShort(num(r.invoiceTotal))}</> : null}</span>
                  </div>
                  <div className="mn-cn-why">
                    <span className="mn-cn-why-text">{String(r.reasonLabel ?? r.reason ?? '—').replace(/_/g, ' ')}</span>
                    {r.remarks ? <span className="mn-ord-meta">{String(r.remarks)}</span> : null}
                  </div>
                  <div className="mn-ord-val">
                    <span className={`mn-ord-amt ${debit ? 'mn-st-in' : 'mn-st-out'}`}>{debit ? '+' : '−'}{money(r.totalAmount)}</span>
                    <span className="mn-ord-meta">{money(r.taxableAmount)} + {money(tax)} GST{r.isInterstate ? ' (IGST)' : ''}</span>
                  </div>
                  <div className="mn-ord-status mn-cn-status">
                    <StatusBadge status={status} />
                    {debit ? <Badge tone="warning">debit</Badge> : <Badge tone="success">credit</Badge>}
                    {status === 'cancelled' && r.cancelReason ? <span className="mn-ord-meta mn-cn-cancel">{String(r.cancelReason)}</span> : null}
                  </div>
                  <div className="mn-ord-act mn-cn-acts">
                    <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/credit-notes/${id}/pdf`, no || `Draft ${debit ? 'debit' : 'credit'} note`).catch((e) => setError(String(e)))}>Print</Button>
                    {status === 'issued' && (
                      <Button variant="ghost" size="sm" icon={<Share2 size={14} />} disabled={busy} onClick={async () => {
                        const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile', defaultValue: '' });
                        if (m === null) return;
                        act(() => openWhatsAppShare(() => creditNotesApi.share(id, m)));
                      }}>Share</Button>
                    )}
                    {canApprove && status === 'draft' && (
                      <Button size="sm" icon={<CheckCircle2 size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Issue ${kindOf(r).toLowerCase()}`, message: `${kindOf(r)} for ${money(r.totalAmount)} against ${r.invoiceNo ? String(r.invoiceNo) : 'the invoice'}. It takes the next number and ${debit ? 'adds to' : 'cuts'} what ${String(r.customerName ?? 'the customer')} owes; it then goes into the GST return.`, confirmLabel: 'Issue' }))) return;
                        act(() => creditNotesApi.issue(id), `${kindOf(r)} issued; the invoice balance has moved.`);
                      }}>Issue</Button>
                    )}
                    {canApprove && status !== 'cancelled' && (
                      <Button variant="ghost" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: status === 'issued' ? `Cancel ${no}` : 'Discard draft', message: status === 'issued' ? `The invoice gets its balance back and the number ${no} stays used, as GST requires; the cancellation is reported.` : 'The draft is removed; nothing was ever applied.', confirmLabel: status === 'issued' ? 'Cancel note' : 'Discard', danger: true }))) return;
                        const reason = status === 'issued' ? await prompt({ title: `Cancel ${no}`, label: 'Why it is cancelled', defaultValue: '' }) : '';
                        if (reason === null) return;
                        act(() => creditNotesApi.cancel(id, reason), status === 'issued' ? `${no} cancelled; the invoice balance is back.` : 'Draft discarded.');
                      }}>{status === 'issued' ? 'Cancel' : 'Discard'}</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} notes` : 'No credit or debit notes'}
            description={filter ? 'Press the chip again to see every note.' : 'Raise one from an issued invoice when something on it has to change after the fact: open the invoice under Billing › Invoices and press Credit note or Debit note.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all notes</Button> : <Link href="/app/billing/invoices" className="mn-ord-link"><Button variant="secondary" size="sm" icon={<FileText size={14} />}>Invoices</Button></Link>}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="notes" />
      </Card>
    </div>
  );
}
