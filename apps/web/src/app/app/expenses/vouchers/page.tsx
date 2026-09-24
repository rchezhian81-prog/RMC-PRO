'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, Factory, Plus, Receipt, RefreshCw, Tags, Trash2, Truck, Wallet, X, XCircle } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, expensesApi, type Row, openPdf } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';
import { todayLocal } from '../../../../lib/report-range';

/**
 * Expense vouchers — the cash and small payments that keep the plant and
 * the trucks running, each line charged to what it was spent on.
 *
 * A stage strip (to post / posted / cancelled) with live counts doubles as
 * the filter, a summary pill totals what is on screen, a note counts the
 * vouchers not yet posted, and each voucher is one row: number and date
 * with how it was paid, who was paid and the plant, the heads and what
 * they were charged to, the amount, the stage, and Print / Post / Cancel.
 * The new-voucher form opens on demand with a line per head, the cost
 * object narrowed by the head's default, and a running total. A card below
 * rolls posted spend up by cost object and by head. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'To post', tone: 'warning', hint: 'Written up; not in the books until it is posted' },
  { key: 'posted', label: 'Posted', tone: 'success', hint: 'In the books and in the cost reports' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn before posting' },
];
const stageOf = (r: Row) => String(r.status ?? 'draft');
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;
const MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
];
const modeOf = (m: unknown) => MODES.find((x) => x.value === String(m ?? ''))?.label ?? (m ? String(m) : '—');
const ALLOC: Array<{ value: string; label: string; hint: string }> = [
  { value: 'general', label: 'General', hint: 'Not tied to a plant, truck or site' },
  { value: 'plant', label: 'A plant', hint: 'Power, water, plant labour' },
  { value: 'vehicle', label: 'A truck or pump', hint: 'Diesel, bata, tolls, repairs' },
  { value: 'site', label: 'A site', hint: 'Spent at a customer\'s site' },
];

interface LineDraft { expenseHeadId: string; description: string; amount: string; allocationType: string; allocationId: string }
const emptyLine = (): LineDraft => ({ expenseHeadId: '', description: '', amount: '', allocationType: 'general', allocationId: '' });
interface Bucket { key: string; label: string; amount: number; share: number }

export default function ExpenseVouchersPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [heads, setHeads] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  const [report, setReport] = useState<Row | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();

  const [payee, setPayee] = useState('');
  const [mode, setMode] = useState('cash');
  const [plantId, setPlantId] = useState('');
  const [voucherDate, setVoucherDate] = useState(todayLocal());
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const canManage = getAccess().has('expenses.manage');
  const canPost = getAccess().has('expenses.post');

  const targetsFor = (type: string): Row[] => (type === 'plant' ? plants : type === 'vehicle' ? vehicles : type === 'site' ? sites : []);
  const targetLabel = (r: Row) => String(r.plantName ?? r.vehicleNo ?? r.siteName ?? r.id);

  const reload = useCallback(async () => {
    const [v, h, p, ve, s, rep] = await Promise.all([
      expensesApi.vouchers(undefined, win.limit), expensesApi.heads(), crud('plants').list({ active: true }), crud('vehicles').list({ active: true }), crud('sites').list({ active: true }),
      // The roll-up is a second read model; if it fails the list still shows.
      expensesApi.allocationReport().catch(() => null),
    ]);
    setRows(v);
    setHeads(h);
    setPlants(p);
    setVehicles(ve);
    setSites(s);
    setReport(rep);
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  // Picking a head sets where the money usually goes (a diesel head charges
  // a truck), so the line only needs the which.
  function pickHead(i: number, expenseHeadId: string) {
    const h = heads.find((x) => String(x.id) === expenseHeadId);
    const t = String(h?.defaultCostType ?? 'general');
    setLine(i, { expenseHeadId, allocationType: ALLOC.some((a) => a.value === t) ? t : 'general', allocationId: '' });
  }
  const formTotal = lines.reduce((t, l) => t + num(l.amount), 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const payloadLines = lines
      .filter((l) => l.expenseHeadId && num(l.amount) > 0)
      .map((l) => ({
        expenseHeadId: l.expenseHeadId, description: l.description || undefined,
        amount: num(l.amount), allocationType: l.allocationType,
        allocationId: l.allocationType === 'general' ? undefined : (l.allocationId || undefined),
      }));
    if (!payloadLines.length) { setError('Add at least one line with a head and an amount.'); return; }
    if (lines.some((l) => l.expenseHeadId && num(l.amount) > 0 && l.allocationType !== 'general' && !l.allocationId)) { setError('Say which plant, truck or site each line is charged to, or set it to General.'); return; }
    setBusy(true);
    try {
      const v = await expensesApi.createVoucher({ payee: payee || undefined, paymentMode: mode, plantId: plantId || undefined, voucherDate: voucherDate || todayLocal(), lines: payloadLines });
      setMsg(`${String(v.voucherNo)} written up for ${money(v.totalAmount)}. Post it to put it in the books.`);
      setPayee('');
      setPlantId('');
      setVoucherDate(todayLocal());
      setLines([emptyLine()]);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      await reload();
      setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (filter ? rows.filter((r) => stageOf(r) === filter) : rows), [rows, filter]);
  const shownTotal = shown.filter((r) => stageOf(r) !== 'cancelled').reduce((t, r) => t + num(r.totalAmount), 0);
  const toPost = counts.get('draft') ?? 0;
  const byCostObject = (report?.byCostObject as { total: number; buckets: Bucket[] } | undefined) ?? null;
  const byHead = (report?.byHead as { total: number; buckets: Bucket[] } | undefined) ?? null;
  const activeHeads = heads.filter((h) => String(h.status ?? 'active') === 'active');

  return (
    <div className="mn-ord mn-ev">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Expense vouchers</h1>
          <p>The cash and small payments that keep the plant and the trucks running: driver bata, diesel, power, repairs, sundries. Each line says what it was for and what it was spent on, so the cost of a truck or a plant adds up at the end of the month.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Wallet size={14} aria-hidden />
            {loaded ? `${shown.length} ${filter ? labelOf(filter) : ''} ${shown.length === 1 ? 'voucher' : 'vouchers'} · ${moneyShort(shownTotal)}` : 'Loading…'}
          </span>
          {canManage && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>New voucher</Button>}
          <Link href="/app/expenses/heads" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Tags size={14} />}>Expense heads</Button>
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

      {loaded && toPost > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('draft')}>
            <Receipt size={16} aria-hidden />
            <span><strong>{toPost} {toPost === 1 ? 'voucher is' : 'vouchers are'} written up but not posted.</strong> The money has gone out but it is not in the books or the cost reports yet; post each one once the receipt is checked.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canManage && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New expense voucher</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          {!activeHeads.length ? (
            <p className="mn-board-form-hint" style={{ marginTop: 0 }}>There are no expense heads yet. Set them up under <Link href="/app/expenses/heads" className="mn-id-link">Expense heads</Link> first (Driver bata, Diesel, Electricity, and so on); each line of a voucher is charged to one.</p>
          ) : null}
          <Form onSubmit={create} className="mn-ev-form">
            <div className="mn-ev-form-head">
              <Field label="Paid to" help="The person or shop the money went to.">
                <Input value={payee} placeholder="e.g. Sample Driver, HP pump, TANGEDCO" onChange={(e) => setPayee(e.target.value)} />
              </Field>
              <Field label="How it was paid">
                <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {MODES.map((mm) => <option key={mm.value} value={mm.value}>{mm.label}</option>)}
                </Select>
              </Field>
              <Field label="Date">
                <Input type="date" max={todayLocal()} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
              </Field>
              <Field label="Booked at plant" help="Which plant's cash book this comes out of.">
                <Select value={plantId || (plants.length === 1 ? String(plants[0]?.id ?? '') : '')} onChange={(e) => setPlantId(e.target.value)}>
                  <option value="">No plant</option>
                  {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mn-ev-lines">
              <div className="mn-ev-line mn-ev-line--head" aria-hidden>
                <span>Head</span>
                <span>What for</span>
                <span className="is-num">Amount</span>
                <span>Charged to</span>
                <span>Which one</span>
                <span />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="mn-ev-line">
                  <Select value={l.expenseHeadId} onChange={(e) => pickHead(i, e.target.value)} aria-label="Expense head">
                    <option value="">Choose a head…</option>
                    {activeHeads.map((h) => <option key={String(h.id)} value={String(h.id)}>{String(h.headName)}{h.groupLabel ? ` · ${String(h.groupLabel)}` : ''}</option>)}
                  </Select>
                  <Input value={l.description} placeholder="e.g. Night trips 20–22 Sept" aria-label="What for" onChange={(e) => setLine(i, { description: e.target.value })} />
                  <Input type="number" step="any" min={0} inputMode="decimal" className="is-num" placeholder="₹" aria-label="Amount" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
                  <Select value={l.allocationType} onChange={(e) => setLine(i, { allocationType: e.target.value, allocationId: '' })} aria-label="Charged to">
                    {ALLOC.map((t) => <option key={t.value} value={t.value} title={t.hint}>{t.label}</option>)}
                  </Select>
                  <Select value={l.allocationId} disabled={l.allocationType === 'general'} onChange={(e) => setLine(i, { allocationId: e.target.value })} aria-label="Which one">
                    <option value="">{l.allocationType === 'general' ? '—' : 'Choose…'}</option>
                    {targetsFor(l.allocationType).map((t) => <option key={String(t.id)} value={String(t.id)}>{targetLabel(t)}</option>)}
                  </Select>
                  <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} />
                </div>
              ))}
            </div>
            <div className="mn-ev-form-foot">
              <Button type="button" variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setLines((p) => [...p, emptyLine()])}>Add a line</Button>
              <span className="mn-ord-how">{formTotal > 0 ? `Voucher total ${money(formTotal)}` : 'Charged to sets where the cost lands: a truck, a plant, a site, or general overhead.'}</span>
              <div className="mn-ev-form-submit">
                <Button type="submit" loading={busy} icon={<Receipt size={14} />}>Write up the voucher</Button>
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Receipt size={16} aria-hidden /> Vouchers <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Post once the receipt is checked; a posted voucher counts in the cost reports.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Voucher</span>
              <span>Paid to</span>
              <span>For</span>
              <span className="is-num">Amount</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const id = String(r.id);
              return (
                <div key={id} className={`mn-ord-row mn-ord-row--acts mn-ev-row${stage === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.voucherNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDate(r.voucherDate ?? r.createdAt)}<span className="mn-ord-dot" aria-hidden>·</span>{modeOf(r.paymentMode)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{r.payee ? String(r.payee) : 'No payee'}</span>
                    <span className="mn-ord-meta">{r.plantName ? String(r.plantName) : 'No plant'}</span>
                  </div>
                  <div className="mn-pu-mats">
                    <span className="mn-pu-mats-text">{r.headLabels ? String(r.headLabels) : <span className="mn-ord-meta">No lines</span>}</span>
                    <span className="mn-ord-meta">{r.allocations ? `charged to ${String(r.allocations)}` : ''}{num(r.lineCount) > 1 ? ` · ${num(r.lineCount)} lines` : ''}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.totalAmount)}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={stage} /></div>
                  <div className="mn-ord-act mn-ev-acts">
                    <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/expense-vouchers/${id}/pdf`, String(r.voucherNo ?? '')).catch((e) => setError(String(e)))}>Print</Button>
                    {canPost && stage === 'draft' && (
                      <Button size="sm" icon={<CheckCircle2 size={14} />} disabled={busy} onClick={() => act(() => expensesApi.postVoucher(id), `${String(r.voucherNo)} posted; ${money(r.totalAmount)} is in the books.`)}>Post</Button>
                    )}
                    {canManage && stage === 'draft' && (
                      <Button variant="ghost" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Cancel ${String(r.voucherNo)}`, message: 'The voucher is withdrawn; nothing reaches the books. This cannot be undone.', confirmLabel: 'Cancel voucher', danger: true }))) return;
                        act(() => expensesApi.cancelVoucher(id), `${String(r.voucherNo)} cancelled.`);
                      }}>Cancel</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} vouchers` : 'No expense vouchers yet'}
            description={filter ? 'Press the chip again to see every voucher.' : canManage ? 'Press New voucher to book the first payment: who was paid, how, and a line per head saying what it was for and what it was spent on.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all vouchers</Button> : canManage ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New voucher</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="vouchers" />
      </Card>

      <div className="mn-ir-two">
        <Card title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> Posted spend by what it was for <span className="mn-board-card-count">{byCostObject?.buckets.length ?? 0}</span></span>} padded={false}>
          {!loaded ? (
            <TableSkeleton cols={3} />
          ) : byCostObject?.buckets.length ? (
            <Table>
              <thead><tr><Th>Charged to</Th><Th numeric>Spent</Th><Th numeric>Share</Th></tr></thead>
              <tbody>
                {byCostObject.buckets.map((b) => (
                  <tr key={b.key}>
                    <Td><span className="mn-od-num">{b.label}</span></Td>
                    <Td numeric>{money(b.amount)}</Td>
                    <Td numeric>{b.share}%<span className="mn-od-linebar mn-pr-bar" aria-hidden><span style={{ width: `${Math.max(4, num(b.share))}%` }} /></span></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="mn-ir-total"><Td>All posted</Td><Td numeric><span className="mn-ir-total-value">{money(byCostObject.total)}</span></Td><Td numeric>100%</Td></tr></tfoot>
            </Table>
          ) : (
            <EmptyState title="Nothing posted yet" description="Once vouchers are posted, the spend rolls up here by truck, plant, site and general." />
          )}
        </Card>
        <Card title={<span className="mn-board-card-title"><Factory size={16} aria-hidden /> Posted spend by head <span className="mn-board-card-count">{byHead?.buckets.length ?? 0}</span></span>} padded={false}>
          {!loaded ? (
            <TableSkeleton cols={3} />
          ) : byHead?.buckets.length ? (
            <Table>
              <thead><tr><Th>Head</Th><Th numeric>Spent</Th><Th numeric>Share</Th></tr></thead>
              <tbody>
                {byHead.buckets.map((b) => (
                  <tr key={b.key}>
                    <Td><span className="mn-od-num">{b.label}</span></Td>
                    <Td numeric>{money(b.amount)}</Td>
                    <Td numeric>{b.share}%<span className="mn-od-linebar mn-pr-bar" aria-hidden><span style={{ width: `${Math.max(4, num(b.share))}%` }} /></span></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="mn-ir-total"><Td>All posted</Td><Td numeric><span className="mn-ir-total-value">{money(byHead.total)}</span></Td><Td numeric>100%</Td></tr></tfoot>
            </Table>
          ) : (
            <EmptyState title="Nothing posted yet" description="Once vouchers are posted, the spend rolls up here by expense head." />
          )}
        </Card>
      </div>
    </div>
  );
}
