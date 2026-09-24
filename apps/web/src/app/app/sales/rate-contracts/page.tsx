'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CalendarClock, ChevronRight, FileSignature, Hourglass, Plus, RefreshCw, X } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { todayLocal } from '../../../../lib/report-range';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, rateContractsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Rate contracts — the agreed prices per customer, and how much has been
 * booked against each.
 *
 * A stage strip (draft / awaiting approval / in force / expired / rejected)
 * with live counts doubles as the filter, a summary pill counts the
 * contracts in force, notes call out the ones waiting for approval and the
 * ones about to expire, and each contract is one tappable row: number and
 * date, the customer and site, the grades with the rate range, the validity
 * (ending soon in amber, over in red), what has been ordered against it, and
 * its stage. The new-contract form opens on demand. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const PAYMENT_TERMS = ['Advance (100%)', 'Cash on delivery', 'Credit — 15 days', 'Credit — 30 days', 'Credit — 45 days', 'Credit — 60 days'];

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'info', hint: 'Being prepared; add the grade rates, then submit' },
  { key: 'submitted', label: 'Awaiting approval', tone: 'warning', hint: 'Submitted; needs an approve or reject' },
  { key: 'approved', label: 'In force', tone: 'success', hint: 'Approved and within its dates; orders can be booked at these rates' },
  { key: 'expired', label: 'Expired', tone: 'neutral', hint: 'Approved, but its valid-to date has passed' },
  { key: 'rejected', label: 'Rejected', tone: 'danger', hint: 'Turned down; revise and re-submit' },
];
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
/** One bucket per contract: an approved contract past its valid-to date is expired. */
const stageOf = (r: Row) => {
  const st = String(r.approvalStatus ?? 'draft');
  if (st === 'approved' && (daysUntil(r.validTo) ?? 0) < 0) return 'expired';
  return st;
};
const toneOf = (stage: string): Tone => STAGES.find((s) => s.key === stage)?.tone ?? 'neutral';
const labelOf = (stage: string) => STAGES.find((s) => s.key === stage)?.label.toLowerCase() ?? stage;
/** What the validity window means right now, for the row's validity column. */
function validity(r: Row): { label: string; tone: Tone } {
  const stage = stageOf(r);
  if (stage === 'rejected') return { label: r.remarks ? `Reason: ${String(r.remarks)}` : 'Revise and re-submit', tone: 'neutral' };
  const to = daysUntil(r.validTo);
  const from = daysUntil(r.validFrom);
  if (to === null && from === null) return { label: 'No dates set', tone: stage === 'approved' ? 'warning' : 'neutral' };
  if (to !== null && to < 0) return { label: to === -1 ? 'Ended yesterday' : `Ended ${-to} days ago`, tone: stage === 'approved' || stage === 'expired' ? 'danger' : 'neutral' };
  if (from !== null && from > 0) return { label: `Starts in ${from} ${from === 1 ? 'day' : 'days'}`, tone: 'info' };
  if (to === null) return { label: 'Open-ended', tone: 'neutral' };
  if (to === 0) return { label: 'Ends today', tone: 'warning' };
  if (to <= 30) return { label: `Ends in ${to} ${to === 1 ? 'day' : 'days'}`, tone: 'warning' };
  return { label: `${to} days left`, tone: 'neutral' };
}

export default function RateContractsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  // A contract starts today and runs a year unless told otherwise.
  const blank = () => {
    const to = new Date();
    to.setFullYear(to.getFullYear() + 1);
    to.setDate(to.getDate() - 1);
    return { customerId: '', siteId: '', validFrom: todayLocal(), validTo: todayLocal(to), paymentTerms: '', transportTerms: '', pumpTerms: '' };
  };
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [rc, c, s] = await Promise.all([rateContractsApi.list(win.limit), crud('customers').list({ active: true }), crud('sites').list({ active: true })]);
    setRows(rc);
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
      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];
      await rateContractsApi.create(payload);
      setForm(blank());
      setShowForm(false);
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
  const inForce = counts.get('approved') ?? 0;
  const waiting = counts.get('submitted') ?? 0;
  const endingSoon = rows.filter((r) => stageOf(r) === 'approved' && (daysUntil(r.validTo) ?? 99) <= 30).length;
  const orderedValue = useMemo(() => shown.reduce((t, r) => t + num(r.orderValue), 0), [shown]);

  return (
    <div className="mn-ord mn-rc">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Rate contracts</h1>
          <p>Prices agreed with a customer for a period, grade by grade. Once approved, orders booked under the contract carry its rates, so no one re-negotiates at the plant gate.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <FileSignature size={14} aria-hidden />
            {loaded ? `${inForce} in force` : 'Loading…'}{orderedValue > 0 ? ` · ${moneyShort(orderedValue)} ordered` : ''}
          </span>
          {!showForm && <Button icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New contract</Button>}
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

      {loaded && !filter && (waiting > 0 || endingSoon > 0) && (
        <div className="mn-ord-notes">
          {waiting > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('submitted')}>
              <Hourglass size={16} aria-hidden />
              <span><strong>{waiting} {waiting === 1 ? 'contract is' : 'contracts are'} waiting for approval.</strong> Open one and approve it, or reject it with a reason.</span>
            </button>
          )}
          {endingSoon > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('approved')}>
              <CalendarClock size={16} aria-hidden />
              <span><strong>{endingSoon} {endingSoon === 1 ? 'contract ends' : 'contracts end'} within 30 days.</strong> Agree the next period with the customer and raise a new contract before it lapses.</span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      {showForm && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New rate contract</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={create} className="mn-rc-form">
            <Field label="Customer" required>
              <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value, siteId: '' })} required>
                <option value="">Choose…</option>
                {customers.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>{String(c.customerName)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Site" help="Leave blank when the rates apply to every site of the customer.">
              <Select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                <option value="">All sites</option>
                {siteOptions.map((s) => (
                  <option key={String(s.id)} value={String(s.id)}>{String(s.siteName)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Valid from" required>
              <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required />
            </Field>
            <Field label="Valid to" required>
              <Input type="date" min={form.validFrom || undefined} value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} required />
            </Field>
            <Field label="Payment terms">
              <Select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
                <option value="">—</option>
                {PAYMENT_TERMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="Transport terms" help="e.g. up to 15 km included, ₹40/km beyond.">
              <Input value={form.transportTerms} onChange={(e) => setForm({ ...form, transportTerms: e.target.value })} />
            </Field>
            <Field label="Pump terms" help="e.g. ₹350/m³ when pumped; minimum 20 m³.">
              <Input value={form.pumpTerms} onChange={(e) => setForm({ ...form, pumpTerms: e.target.value })} />
            </Field>
            <div className="mn-rc-form-submit">
              <Button type="submit" loading={creating} icon={<FileSignature size={14} />}>Create contract</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </Form>
          <p className="mn-board-form-hint">After creating, open the contract to add the rate per grade, then submit it for approval.</p>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><FileSignature size={16} aria-hidden /> Contracts <span className="mn-board-card-count">{shown.length}</span></span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Contract</span>
              <span>Customer</span>
              <span>Rates</span>
              <span>Validity</span>
              <span className="is-num">Ordered</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const v = validity(r);
              const items = num(r.itemCount);
              const orders = num(r.orderCount);
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts${stage === 'rejected' || stage === 'expired' ? ' is-void' : ''}`} data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <Link href={`/app/sales/rate-contracts/${String(r.id)}`} className="mn-ord-no mn-ord-stretch">{String(r.rateContractNo ?? '')}</Link>
                    <span className="mn-ord-meta">{formatDate(r.createdAt)}{r.paymentTerms ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.paymentTerms)}</> : null}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? 'Customer not set')}</span>
                    <span className="mn-ord-meta">{r.siteName ? String(r.siteName) : 'All sites'}</span>
                  </div>
                  <div className="mn-rc-rates">
                    {items ? (
                      <>
                        <span className="mn-rc-grades">{String(r.gradeLabels ?? '')}</span>
                        <span className="mn-ord-meta">{num(r.minRate) === num(r.maxRate) ? `${money(r.minRate)}/m³` : `${money(r.minRate)} – ${money(r.maxRate)}/m³`}</span>
                      </>
                    ) : (
                      <span className="mn-ord-meta">No grade rates yet</span>
                    )}
                  </div>
                  <div className="mn-ord-when" data-tone={v.tone}>
                    <span className="mn-ord-when-d">{r.validFrom || r.validTo ? `${r.validFrom ? formatDate(r.validFrom) : '…'} → ${r.validTo ? formatDate(r.validTo) : '…'}` : '—'}</span>
                    <span className="mn-ord-meta mn-ord-when-m">{v.label}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{orders ? money(r.orderValue) : '—'}</span>
                    <span className="mn-ord-meta">{orders ? `${orders} ${orders === 1 ? 'order' : 'orders'} · ${qty(r.orderedM3)} m³` : 'Nothing booked yet'}</span>
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={String(r.approvalStatus ?? 'draft')} />
                  </div>
                  <div className="mn-ord-go">
                    <ChevronRight size={18} aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} contracts` : 'No rate contracts yet'}
            description={filter ? 'Nothing at this stage right now. Press the chip again to see every contract.' : 'Create the first contract with New contract: pick the customer and the period, then open it to add the rate per grade.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all contracts</Button> : <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New contract</Button>}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="rate contracts" />
      </Card>
    </div>
  );
}
