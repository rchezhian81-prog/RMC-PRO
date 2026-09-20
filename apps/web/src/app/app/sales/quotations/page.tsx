'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ChevronRight, ClipboardList, Download, FileText, Hourglass, Plus, RefreshCw, Send } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { todayLocal } from '../../../../lib/report-range';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, quotationsApi, type Row, openPdf } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Quotations — the sales pipeline at a glance.
 *
 * A stage strip (draft / awaiting approval / approved / rejected / converted)
 * with live counts doubles as the filter, a summary pill totals what is on
 * screen, a note flags quotations waiting on someone, and each quotation is
 * one tappable row: number and date, who it is for, the quoted value with the
 * grades and volume, how long it stays valid, and its stage. The new-quotation
 * form keeps its place at the top. Same layout in both skins.
 */

/** Common payment terms for an Indian RMC plant — a picklist beats free text. */
const PAYMENT_TERMS = [
  'Advance (100%)',
  'Cash on delivery',
  'Credit — 15 days',
  'Credit — 30 days',
  'Credit — 45 days',
  'UPI',
  'NEFT / RTGS',
  'Cheque',
];

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'info', hint: 'Being prepared; add grade items, then submit' },
  { key: 'submitted', label: 'Awaiting approval', tone: 'warning', hint: 'Submitted; needs an approve or reject' },
  { key: 'approved', label: 'Approved', tone: 'success', hint: 'Approved and ready to convert into an order' },
  { key: 'rejected', label: 'Rejected', tone: 'danger', hint: 'Turned down; revise and re-submit' },
  { key: 'converted', label: 'Converted', tone: 'neutral', hint: 'Already turned into an order' },
];
/** One bucket per quotation: converted wins over its (approved) approval status. */
const stageOf = (r: Row) => (String(r.status) === 'converted' ? 'converted' : String(r.approvalStatus ?? 'draft'));
const toneOf = (stage: string): Tone => STAGES.find((s) => s.key === stage)?.tone ?? 'neutral';
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
/** What the validity date means right now, for the row's fourth column. */
function validity(r: Row): { label: string; tone: Tone } {
  const stage = stageOf(r);
  if (stage === 'converted') return { label: 'Converted to an order', tone: 'success' };
  if (stage === 'rejected') return { label: r.remarks ? `Reason: ${String(r.remarks)}` : 'Revise and re-submit', tone: 'neutral' };
  const raw = r.validUntil == null ? '' : String(r.validUntil).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { label: 'No expiry set', tone: 'neutral' };
  const days = daysUntil(raw);
  if (days < 0) return { label: days === -1 ? 'Expired yesterday' : `Expired ${-days} days ago`, tone: 'danger' };
  if (days === 0) return { label: 'Expires today', tone: 'warning' };
  if (days <= 7) return { label: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'warning' };
  return { label: `${days} days left`, tone: 'neutral' };
}

export default function QuotationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  // The date starts at today so a quotation always carries one (the API stores whatever is sent).
  const blank = () => ({ customerId: '', siteId: '', quotationDate: todayLocal(), validUntil: '', paymentTerms: '' });
  const [form, setForm] = useState(blank);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [q, c, s] = await Promise.all([quotationsApi.list(win.limit), crud('customers').list(), crud('sites').list()]);
    setRows(q);
    setCustomers(c);
    setSites(s);
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

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.customerId) delete payload.customerId;
      if (!payload.siteId) delete payload.siteId;
      await quotationsApi.create(payload);
      setForm(blank());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }

  // Sites narrow to the chosen customer, so a site cannot be picked for the wrong customer.
  const siteOptions = form.customerId ? sites.filter((s) => String(s.customerId ?? '') === form.customerId) : sites;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (filter ? rows.filter((r) => stageOf(r) === filter) : rows), [rows, filter]);
  const totalValue = useMemo(() => shown.reduce((t, r) => t + num(r.estimatedValue), 0), [shown]);
  const waiting = counts.get('submitted') ?? 0;
  const ready = counts.get('approved') ?? 0;
  const stageLabel = (key: string) => STAGES.find((s) => s.key === key)?.label.toLowerCase() ?? '';

  return (
    <div className="mn-ord">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Quotations</h1>
          <p>Quote a customer per grade, submit it for approval, and convert the approved quotation into an order so every order carries an agreed price.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ClipboardList size={14} aria-hidden />
            {shown.length} {filter ? stageLabel(filter) : ''} {shown.length === 1 ? 'quotation' : 'quotations'}
            {' · '}
            {moneyShort(totalValue)} quoted
          </span>
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

      {!filter && (waiting > 0 || ready > 0) && (
        <div className="mn-ord-notes">
          {waiting > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('submitted')}>
              <Hourglass size={16} aria-hidden />
              <span>
                <strong>{waiting} {waiting === 1 ? 'quotation is' : 'quotations are'} waiting for approval.</strong> Open one and click Approve or Reject.
              </span>
            </button>
          )}
          {ready > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--ok mn-ord-note--btn" onClick={() => setFilter('approved')}>
              <Send size={16} aria-hidden />
              <span>
                <strong>{ready} approved {ready === 1 ? 'quotation is' : 'quotations are'} ready to convert.</strong> Open one and click Convert → Order draft.
              </span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New quotation</span>}>
        <Form onSubmit={create} className="mn-qt-form">
          <Field label="Customer">
            <select className="mn-input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value, siteId: '' })}>
              <option value="">— select —</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>
              ))}
            </select>
          </Field>
          <Field label="Site">
            <select className="mn-input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">— select —</option>
              {siteOptions.map((s) => (
                <option key={s.id} value={String(s.id)}>{String(s.siteName)}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.quotationDate} onChange={(e) => setForm({ ...form, quotationDate: e.target.value })} />
          </Field>
          <Field label="Valid until">
            <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </Field>
          <Field label="Payment terms">
            <select className="mn-input" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
              <option value="">— select —</option>
              {PAYMENT_TERMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <div className="mn-qt-form-submit">
            <Button type="submit" loading={creating}>Create</Button>
          </div>
        </Form>
        <p className="mn-board-form-hint">After creating, open the quotation to add grade items, then submit it for approval.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Pipeline <span className="mn-board-card-count">{shown.length}</span></span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Quotation</span>
              <span>Customer</span>
              <span className="is-num">Quoted value</span>
              <span>Validity</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const v = validity(r);
              const rev = num(r.revisionNo);
              const items = num(r.itemCount);
              return (
                <div key={String(r.id)} className="mn-ord-row mn-ord-row--acts" data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <Link href={`/app/sales/quotations/${r.id}`} className="mn-ord-no mn-ord-stretch">{String(r.quotationNo ?? '')}</Link>
                    <span className="mn-ord-meta">
                      {formatDate(r.quotationDate ?? r.createdAt)}
                      {rev > 0 && <><span className="mn-ord-dot" aria-hidden>·</span>Rev {rev}</>}
                    </span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">
                      {String(r.siteName ?? 'No site')}
                      {r.paymentTerms ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.paymentTerms)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{items ? money(r.estimatedValue) : '—'}</span>
                    <span className="mn-ord-meta">{items ? `${items} ${items === 1 ? 'grade' : 'grades'} · ${qty(r.totalM3)} m³` : 'No grade items yet'}</span>
                  </div>
                  <div className="mn-ord-when" data-tone={v.tone}>
                    <span className="mn-ord-when-d">{r.validUntil ? `Till ${formatDate(r.validUntil)}` : '—'}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{v.label}</span>
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={String(r.approvalStatus ?? 'draft')} />
                    {stage === 'converted' && <Badge tone="neutral">converted</Badge>}
                  </div>
                  <div className="mn-ord-go">
                    <span className="mn-ord-act">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Download size={14} />}
                        aria-label={`Print ${String(r.quotationNo ?? '')}`}
                        onClick={() => openPdf(`/quotations/${String(r.id)}/pdf`, String(r.quotationNo ?? '')).catch((e) => setError(String(e)))}
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
            title={filter ? `No ${stageLabel(filter)} quotations` : 'No quotations yet'}
            description={filter ? 'Nothing at this stage right now. Press the chip again to see every quotation.' : 'Create your first quotation above, then open it to add grade items.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all quotations</Button> : undefined}
          />
        )}
        <ListCap shown={shown.length} limit={win.limit} canWiden={win.canWiden}
          onWiden={() => win.setLimit(win.widen())} noun="quotations" />
      </Card>
    </div>
  );
}
