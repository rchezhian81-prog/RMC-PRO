'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, FileText, MessageSquare, PhoneCall, Plus, RefreshCw, Trophy, UserPlus, X, XCircle } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../../lib/format-date';
import { todayLocal } from '../../../../lib/report-range';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { leadsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Sales leads — the enquiries and where each one stands.
 *
 * A stage strip (new / qualified / quoted / won / lost) with live counts
 * doubles as the filter, a summary pill counts the open leads and the
 * follow-ups due today, notes call out the follow-ups that are overdue or
 * due today, and each lead is one tappable row: number and source, who and
 * how to reach them, what they need and where, the next follow-up (overdue
 * in red, today in amber) with the last outcome, and the stage. Opening a
 * lead shows the worksheet: log a follow-up (and move the stage), the
 * follow-up history, and the details to edit; Won and Lost are one press.
 * Same layout in both skins; every colour reads the semantic tokens.
 */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'new', label: 'New', tone: 'info', hint: 'Just captured; call back to qualify it' },
  { key: 'qualified', label: 'Qualified', tone: 'info', hint: 'A real requirement; quote it' },
  { key: 'quoted', label: 'Quoted', tone: 'warning', hint: 'Quotation sent; waiting on the customer' },
  { key: 'won', label: 'Won', tone: 'success', hint: 'Became an order or a rate contract' },
  { key: 'lost', label: 'Lost', tone: 'danger', hint: 'Did not convert; the reason is kept' },
];
const OPEN = ['new', 'qualified', 'quoted'];
const stageOf = (r: Row) => String(r.leadStage ?? 'new');
const toneOf = (stage: string): Tone => STAGES.find((s) => s.key === stage)?.tone ?? 'neutral';
const labelOf = (stage: string) => STAGES.find((s) => s.key === stage)?.label.toLowerCase() ?? stage;

const SOURCES = ['Walk-in', 'Phone call', 'WhatsApp', 'Referral', 'Site visit', 'Existing customer', 'Website', 'Other'];
const OUTCOMES = ['Called', 'Visited', 'Sent quote', 'Meeting', 'No answer', 'Call back later', 'Negotiating', 'Won', 'Lost'];

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
/** What the next follow-up date means right now, for the row's fourth column. */
function followupCell(r: Row): { label: string; tone: Tone } {
  const stage = stageOf(r);
  if (stage === 'won') return { label: 'Won', tone: 'success' };
  if (stage === 'lost') return { label: r.lostReason ? `Lost: ${String(r.lostReason)}` : 'Lost', tone: 'neutral' };
  const days = daysUntil(r.nextFollowupDate);
  if (days === null) return { label: 'No follow-up planned', tone: 'warning' };
  if (days < 0) return { label: days === -1 ? 'Overdue since yesterday' : `Overdue by ${-days} days`, tone: 'danger' };
  if (days === 0) return { label: 'Due today', tone: 'warning' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'neutral' };
  return { label: `Due in ${days} days`, tone: 'neutral' };
}

export default function LeadsPage() {
  const { prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const blank = () => ({ customerName: '', contactPerson: '', mobile: '', siteLocation: '', leadSource: '', requirementNotes: '', nextFollowupDate: '' });
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState({ customerName: '', contactPerson: '', mobile: '', email: '', siteLocation: '', leadSource: '', requirementNotes: '', lostReason: '' });
  const [fu, setFu] = useState({ notes: '', outcome: '', nextFollowupDate: '', leadStage: '' });
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    setRows(await leadsApi.list(win.limit));
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  // Arriving with ?lead=<id> (a link from a message) opens that lead.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('lead');
    if (id) open(id).catch((e) => setError(String(e)));
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      if (sel) await open(String(sel.id));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function open(id: string) {
    setError(null);
    const l = await leadsApi.get(id);
    setSel(l);
    setEdit({
      customerName: String(l.customerName ?? ''), contactPerson: String(l.contactPerson ?? ''),
      mobile: String(l.mobile ?? ''), email: String(l.email ?? ''), siteLocation: String(l.siteLocation ?? ''), leadSource: String(l.leadSource ?? ''),
      requirementNotes: String(l.requirementNotes ?? ''), lostReason: String(l.lostReason ?? ''),
    });
    setFu({ notes: '', outcome: '', nextFollowupDate: '', leadStage: '' });
    setMsg(null);
  }
  function close() {
    setSel(null);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await leadsApi.create(form);
      setForm(blank());
      setShowForm(false);
      await reload();
      setMsg(`${String(created.leadNo ?? 'Lead')} captured for ${form.customerName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    setError(null);
    setBusy(true);
    try {
      await leadsApi.update(String(sel.id), edit);
      await open(String(sel.id));
      await reload();
      setMsg('Details saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function addFollowup(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    if (!fu.notes.trim() && !fu.outcome) {
      setError('Say what happened: pick an outcome or write a note.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await leadsApi.addFollowup(String(sel.id), fu);
      await open(String(sel.id));
      await reload();
      setMsg(fu.nextFollowupDate ? `Follow-up logged; next one on ${formatDate(fu.nextFollowupDate)}.` : 'Follow-up logged.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function markWon(r: Row) {
    const note = await prompt({
      title: `Mark ${String(r.customerName)} as won`,
      message: 'The lead moves to Won and leaves the follow-up list. Book the order under Orders, or the rate contract under Rate contracts.',
      label: 'What was agreed (optional)',
      defaultValue: '',
      confirmLabel: 'Mark won',
    });
    if (note === null) return;
    setBusy(true);
    try {
      await leadsApi.addFollowup(String(r.id), { notes: note, outcome: 'Won', leadStage: 'won' });
      await reload();
      if (sel && sel.id === r.id) await open(String(r.id));
      setMsg(`${String(r.leadNo)} marked won.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }
  async function markLost(r: Row) {
    const reason = await prompt({
      title: `Mark ${String(r.customerName)} as lost`,
      message: 'The lead moves to Lost with the reason, so the pattern (price, distance, timing) can be seen later. It can be reopened by moving the stage again.',
      label: 'Why it was lost',
      defaultValue: '',
      confirmLabel: 'Mark lost',
    });
    if (reason === null) return;
    if (!reason.trim()) {
      setError('Give the reason it was lost.');
      return;
    }
    setBusy(true);
    try {
      await leadsApi.update(String(r.id), { leadStage: 'lost', lostReason: reason });
      await leadsApi.addFollowup(String(r.id), { notes: reason, outcome: 'Lost' });
      await reload();
      if (sel && sel.id === r.id) await open(String(r.id));
      setMsg(`${String(r.leadNo)} marked lost.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => {
    const list = filter ? rows.filter((r) => stageOf(r) === filter) : rows;
    // Overdue first, then due today, then by next date; won and lost last.
    const rank = (r: Row) => {
      const stage = stageOf(r);
      if (!OPEN.includes(stage)) return 4;
      const d = daysUntil(r.nextFollowupDate);
      if (d === null) return 3;
      if (d < 0) return 0;
      if (d === 0) return 1;
      return 2;
    };
    return [...list].sort((a, b) => rank(a) - rank(b) || String(a.nextFollowupDate ?? '').localeCompare(String(b.nextFollowupDate ?? '')));
  }, [rows, filter]);
  const openLeads = rows.filter((r) => OPEN.includes(stageOf(r)));
  const overdue = openLeads.filter((r) => (daysUntil(r.nextFollowupDate) ?? 1) < 0).length;
  const dueToday = openLeads.filter((r) => daysUntil(r.nextFollowupDate) === 0).length;
  const followups = (sel?.followups as Row[]) ?? [];
  const selStage = sel ? stageOf(sel) : '';

  return (
    <div className="mn-ord mn-ld">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Sales leads</h1>
          <p>Every enquiry, from the first call to an order: who asked, what they need, when to call back, and what happened each time. Log each follow-up here so nothing goes quiet.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <UserPlus size={14} aria-hidden />
            {loaded ? `${openLeads.length} open` : 'Loading…'}{dueToday ? ` · ${dueToday} due today` : ''}{overdue ? ` · ${overdue} overdue` : ''}
          </span>
          {!showForm && (
            <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>New lead</Button>
          )}
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

      {loaded && !filter && (overdue > 0 || dueToday > 0) && (
        <div className="mn-ord-notes">
          {overdue > 0 && (
            <div className="mn-ord-note mn-ord-note--bad">
              <PhoneCall size={16} aria-hidden />
              <span><strong>{overdue} {overdue === 1 ? 'follow-up is' : 'follow-ups are'} overdue.</strong> They sit at the top of the list; call, log what was said, and set the next date.</span>
            </div>
          )}
          {dueToday > 0 && (
            <div className="mn-ord-note mn-ord-note--warn">
              <CalendarClock size={16} aria-hidden />
              <span><strong>{dueToday} {dueToday === 1 ? 'follow-up is' : 'follow-ups are'} due today.</strong></span>
            </div>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New lead</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={create} className="mn-ld-form">
            <Field label="Customer or company" required>
              <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required placeholder="Who is asking" />
            </Field>
            <Field label="Contact person">
              <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} inputMode="tel" />
            </Field>
            <Field label="Site location" help="Area or address; decides the distance and the transport charge.">
              <Input value={form.siteLocation} onChange={(e) => setForm({ ...form, siteLocation: e.target.value })} />
            </Field>
            <Field label="How they found you">
              <Select value={form.leadSource} onChange={(e) => setForm({ ...form, leadSource: e.target.value })}>
                <option value="">—</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Next follow-up" help="When to call back. Leave blank and it shows as not planned.">
              <Input type="date" min={todayLocal()} value={form.nextFollowupDate} onChange={(e) => setForm({ ...form, nextFollowupDate: e.target.value })} />
            </Field>
            <Field label="What they need" help="Grades, quantity, pump, when they want to pour.">
              <Input value={form.requirementNotes} onChange={(e) => setForm({ ...form, requirementNotes: e.target.value })} placeholder="e.g. 400 m³ M25 over 3 months, pump needed" />
            </Field>
            <div className="mn-ld-form-submit">
              <Button type="submit" loading={busy} icon={<UserPlus size={14} />}>Capture lead</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><UserPlus size={16} aria-hidden /> Leads <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Overdue first, then due today, then by date. Press a lead to open it.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Lead</span>
              <span>Who</span>
              <span>Needs</span>
              <span>Follow-up</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const f = followupCell(r);
              const on = sel?.id === r.id;
              const n = Number(r.followupCount ?? 0);
              return (
                <div
                  key={String(r.id)}
                  className={`mn-ord-row mn-ord-row--acts mn-ld-row${stage === 'lost' ? ' is-void' : ''}${on ? ' is-on' : ''}`}
                  data-tone={toneOf(stage)}
                  role="listitem"
                  onClick={() => (on ? close() : open(String(r.id)).catch((e) => setError(String(e))))}
                >
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.leadNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDate(r.createdAt)}{r.leadSource ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.leadSource)}</> : null}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-ord-meta">{[r.contactPerson, r.mobile].filter(Boolean).map(String).join(' · ') || 'No contact yet'}</span>
                  </div>
                  <div className="mn-ld-need">
                    <span className="mn-ld-need-text">{r.requirementNotes ? String(r.requirementNotes) : <span className="mn-ord-meta">Requirement not noted</span>}</span>
                    {r.siteLocation ? <span className="mn-ord-meta">{String(r.siteLocation)}</span> : null}
                  </div>
                  <div className="mn-ord-when" data-tone={f.tone}>
                    <span className="mn-ord-when-d">{OPEN.includes(stage) && r.nextFollowupDate ? formatDate(r.nextFollowupDate) : f.label}</span>
                    <span className="mn-ord-meta mn-ord-when-m">
                      {OPEN.includes(stage) && r.nextFollowupDate ? f.label : ''}
                      {n ? `${OPEN.includes(stage) && r.nextFollowupDate ? ' · ' : ''}${n} ${n === 1 ? 'follow-up' : 'follow-ups'}${r.lastOutcome ? `, last: ${String(r.lastOutcome)}` : ''}` : ''}
                    </span>
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={stage} />
                    {r.quotationNo ? <Badge tone="info">{String(r.quotationNo)}</Badge> : null}
                  </div>
                  <div className="mn-ord-act mn-ld-acts" onClick={(e) => e.stopPropagation()}>
                    {OPEN.includes(stage) && <Button size="sm" variant="ghost" icon={<Trophy size={14} />} onClick={() => markWon(r)} disabled={busy}>Won</Button>}
                    {OPEN.includes(stage) && <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => markLost(r)} disabled={busy}>Lost</Button>}
                    <Button size="sm" variant={on ? 'secondary' : 'ghost'} onClick={() => (on ? close() : open(String(r.id)).catch((e) => setError(String(e))))}>{on ? 'Close' : 'Open'}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} leads` : 'No leads yet'}
            description={filter ? 'Nothing at this stage right now. Press the chip again to see every lead.' : 'Capture the first enquiry with New lead: who is asking, what they need, and when to call back.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all leads</Button> : <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New lead</Button>}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="leads" />
      </Card>

      {sel && (
        <div className="mn-pp-ws" id="lead-worksheet">
          <Card
            title={
              <span className="mn-board-card-title">
                <UserPlus size={16} aria-hidden /> {String(sel.leadNo)} <span className="mn-pp-sub">· {String(sel.customerName)}</span>
                <StatusBadge status={selStage} />
              </span>
            }
            actions={
              <div className="mn-pp-tools">
                {OPEN.includes(selStage) && <Button size="sm" variant="secondary" icon={<Trophy size={14} />} onClick={() => markWon(sel)} disabled={busy}>Mark won</Button>}
                {OPEN.includes(selStage) && <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => markLost(sel)} disabled={busy}>Mark lost</Button>}
                {sel.quotationId ? (
                  <Link href={`/app/sales/quotations/${String(sel.quotationId)}`} className="mn-ord-link"><Button size="sm" variant="ghost" icon={<FileText size={14} />}>Quotation</Button></Link>
                ) : selStage !== 'lost' ? (
                  <Link href="/app/sales/quotations" className="mn-ord-link"><Button size="sm" variant="ghost" icon={<FileText size={14} />}>Quote it</Button></Link>
                ) : null}
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={close}>Close</Button>
              </div>
            }
            padded={false}
          >
            <p className="mn-pp-hint">
              {selStage === 'won' ? 'Won. Book the order under Orders or the rate contract under Rate contracts.' : selStage === 'lost' ? `Lost${sel.lostReason ? `: ${String(sel.lostReason)}` : ''}. Move the stage in a follow-up to reopen it.` : 'Log every call or visit below; set the next date so it comes back to the top when due.'}
            </p>

            {selStage !== 'won' && (
              <Form onSubmit={addFollowup} className="mn-ld-fu">
                <Field label="What happened" required>
                  <Input value={fu.notes} onChange={(e) => setFu({ ...fu, notes: e.target.value })} placeholder="e.g. Spoke to Ramesh; wants M30 rate too" />
                </Field>
                <Field label="Outcome">
                  <Select value={fu.outcome} onChange={(e) => setFu({ ...fu, outcome: e.target.value })}>
                    <option value="">—</option>
                    {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Next follow-up">
                  <Input type="date" min={todayLocal()} value={fu.nextFollowupDate} onChange={(e) => setFu({ ...fu, nextFollowupDate: e.target.value })} />
                </Field>
                <Field label="Move stage to">
                  <Select value={fu.leadStage} onChange={(e) => setFu({ ...fu, leadStage: e.target.value })}>
                    <option value="">Keep {labelOf(selStage)}</option>
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </Select>
                </Field>
                <div className="mn-ld-fu-submit">
                  <Button type="submit" loading={busy} icon={<MessageSquare size={14} />}>Log follow-up</Button>
                </div>
              </Form>
            )}

            <div className="mn-ld-history">
              <h3 className="mn-ld-h">Follow-ups <span className="mn-board-card-count">{followups.length}</span></h3>
              {followups.length ? (
                <ol className="mn-od-tl">
                  {followups.map((f) => {
                    const outcome = String(f.outcome ?? '');
                    const tone: Tone = outcome === 'Won' ? 'success' : outcome === 'Lost' ? 'danger' : outcome === 'No answer' ? 'warning' : 'info';
                    return (
                      <li key={String(f.id)} data-tone={tone}>
                        <span className="mn-od-tl-dot" aria-hidden />
                        <div className="mn-od-tl-body">
                          <span className="mn-od-tl-title">{outcome || 'Follow-up'}</span>
                          <span className="mn-ord-meta">
                            {formatDateTime(f.createdAt)}
                            {f.nextFollowupDate ? <><span className="mn-ord-dot" aria-hidden>·</span>next {formatDate(f.nextFollowupDate)}</> : null}
                          </span>
                          {f.notes ? <span className="mn-od-tl-note">{String(f.notes)}</span> : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mn-board-form-hint">No follow-ups logged yet.</p>
              )}
            </div>

            <Form onSubmit={saveEdit} className="mn-ld-details">
              <h3 className="mn-ld-h mn-ld-h--full">Details</h3>
              <Field label="Customer or company" required>
                <Input value={edit.customerName} onChange={(e) => setEdit({ ...edit, customerName: e.target.value })} required />
              </Field>
              <Field label="Contact person">
                <Input value={edit.contactPerson} onChange={(e) => setEdit({ ...edit, contactPerson: e.target.value })} />
              </Field>
              <Field label="Mobile">
                <Input value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} inputMode="tel" />
              </Field>
              <Field label="Email">
                <Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </Field>
              <Field label="Site location">
                <Input value={edit.siteLocation} onChange={(e) => setEdit({ ...edit, siteLocation: e.target.value })} />
              </Field>
              <Field label="How they found you">
                <Select value={edit.leadSource} onChange={(e) => setEdit({ ...edit, leadSource: e.target.value })}>
                  <option value="">—</option>
                  {[...new Set([...SOURCES, ...(edit.leadSource ? [edit.leadSource] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="What they need">
                <Input value={edit.requirementNotes} onChange={(e) => setEdit({ ...edit, requirementNotes: e.target.value })} />
              </Field>
              {selStage === 'lost' && (
                <Field label="Why it was lost">
                  <Input value={edit.lostReason} onChange={(e) => setEdit({ ...edit, lostReason: e.target.value })} />
                </Field>
              )}
              <div className="mn-ld-fu-submit">
                <Button type="submit" variant="secondary" loading={busy}>Save details</Button>
              </div>
            </Form>
          </Card>
        </div>
      )}
    </div>
  );
}
