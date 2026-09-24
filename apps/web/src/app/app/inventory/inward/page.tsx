'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, CheckCircle2, ClipboardCheck, Package, RefreshCw, Scale, Truck, XCircle } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { money } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, materialInwardApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Material inward — every delivery that arrives at the gate.
 *
 * A status strip (draft / posted / cancelled) with live counts doubles as
 * the filter, a summary pill totals the accepted value on screen, and each
 * inward is one row: number and when it arrived, the material with the
 * supplier, truck and challan, what was accepted against what came (with
 * the rejected part called out), the value at the rate keyed (flagged when
 * far from the material's standard rate), the status, and Post / Cancel for
 * a draft. Drafts still to post get a note. The "new inward" form reads the
 * unit and the standard rate off the material, defaults accepted to
 * received, and shows the value as you type. Same layout in both skins;
 * every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'warning', hint: 'Received at the gate but not yet in stock: check the quantity and rate, then Post' },
  { key: 'posted', label: 'Posted', tone: 'success', hint: 'The accepted quantity was added to stock' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn before posting; nothing reached stock' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;
/** A rate more than a fifth away from the material's standard rate is worth a second look. */
const rateOff = (r: Row) => num(r.standardRate) > 0 && Math.abs(num(r.rate) - num(r.standardRate)) / num(r.standardRate) > 0.2;

const EMPTY = { plantId: '', supplierId: '', materialId: '', quantityReceived: '', quantityAccepted: '', rate: '', vehicleNo: '', supplierChallanNo: '' };

export default function MaterialInwardPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [i, m, s, p] = await Promise.all([materialInwardApi.list(undefined, win.limit), crud('materials').list(), crud('suppliers').list(), crud('plants').list()]);
    setRows(i);
    setMaterials(m);
    setSuppliers(s);
    setPlants(p);
    setForm((f) => (f.plantId || p.length !== 1 ? f : { ...f, plantId: String(p[0]?.id ?? '') }));
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

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
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

  const chosen = materials.find((x) => String(x.id) === form.materialId);
  function pickMaterial(id: string) {
    const m = materials.find((x) => String(x.id) === id);
    // The standard rate is the starting point; the supplier's rate on the challan overrides it.
    setForm((f) => ({ ...f, materialId: id, rate: f.rate || (m && num(m.standardRate) > 0 ? String(num(m.standardRate)) : '') }));
  }
  const received = num(form.quantityReceived);
  const accepted = form.quantityAccepted === '' ? received : num(form.quantityAccepted);
  const preview = accepted * num(form.rate);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.materialId) { setError('Pick the material that arrived.'); return; }
    if (!(received > 0)) { setError('Enter the quantity received.'); return; }
    if (accepted < 0 || accepted > received + 0.0005) { setError('Accepted cannot be more than received.'); return; }
    await run(async () => {
      const created = (await materialInwardApi.create({
        plantId: form.plantId || undefined,
        supplierId: form.supplierId || undefined,
        materialId: form.materialId,
        vehicleNo: form.vehicleNo.trim() || undefined,
        supplierChallanNo: form.supplierChallanNo.trim() || undefined,
        quantityReceived: received,
        quantityAccepted: form.quantityAccepted === '' ? undefined : accepted,
        rate: num(form.rate),
      })) as Row;
      setForm((f) => ({ ...EMPTY, plantId: f.plantId }));
      return `${String(created?.inwardNo ?? 'Inward')} created as a draft. Post it to add ${qty(accepted)} ${String(chosen?.uom ?? '')} to stock.`;
    });
  }

  async function post(r: Row) {
    await run(async () => {
      const out = (await materialInwardApi.post(String(r.id))) as Row;
      return `${String(r.inwardNo)} posted: ${qty(r.quantityAccepted)} ${String(r.uom ?? '')} of ${String(r.materialLabel)} added to stock${out?.balanceAfter != null ? `, now ${qty(out.balanceAfter)} ${String(r.uom ?? '')} on hand` : ''}.`;
    });
  }

  async function cancel(r: Row) {
    if (!(await confirm({ title: 'Cancel inward', message: `Cancel ${String(r.inwardNo)}? Nothing has reached stock yet; the entry stays on record as cancelled.`, confirmLabel: 'Cancel inward', danger: true }))) return;
    await run(() => materialInwardApi.cancel(String(r.id)), `${String(r.inwardNo)} cancelled.`);
  }

  const shown = filter ? rows.filter((r) => String(r.status) === filter) : rows;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.status), (m.get(String(r.status)) ?? 0) + 1);
    return m;
  }, [rows]);
  const totalValue = useMemo(() => shown.reduce((t, r) => (String(r.status) === 'cancelled' ? t : t + num(r.amount)), 0), [shown]);
  const drafts = counts.get('draft') ?? 0;
  const multiPlant = plants.length > 1;

  return (
    <div className="mn-ord mn-mi">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Material inward</h1>
          <p>Every delivery that arrives at the gate: which supplier, what material, how much came and how much was accepted, at what rate. Posting an inward adds the accepted quantity to stock; nothing reaches stock until it is posted.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ArrowDownToLine size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'inward' : 'inwards'}
            {' · '}
            {money(totalValue)}
          </span>
          <Link href="/app/inventory/weighbridge" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<Scale size={14} />}>Weighbridge</Button>
          </Link>
          <Link href="/app/production/stock" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Package size={14} />}>Stock</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Status strip — counts per status; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => {
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

      {drafts > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('draft')}>
            <ClipboardCheck size={16} aria-hidden />
            <span><strong>{drafts} {drafts === 1 ? 'inward is' : 'inwards are'} not posted yet.</strong> Stock does not know about {drafts === 1 ? 'that delivery' : 'those deliveries'} until each one is posted; check the accepted quantity and rate, then Post.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> New inward</span>}>
        <Form onSubmit={create} className="mn-mi-form">
          {multiPlant && (
            <Field label="Plant">
              <Select value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
                <option value="">Pick the plant</option>
                {plants.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Supplier" help={suppliers.length ? undefined : 'No suppliers yet: add them under Masters → Suppliers'}>
            <Select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">{suppliers.length ? 'Pick the supplier' : 'No suppliers set up'}</option>
              {suppliers.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>{String(s.supplierName)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Material" required>
            <Select value={form.materialId} onChange={(e) => pickMaterial(e.target.value)} required>
              <option value="">Pick the material</option>
              {materials.map((m) => (
                <option key={String(m.id)} value={String(m.id)}>{String(m.materialName)}{m.uom ? ` (${String(m.uom)})` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label={chosen ? `Received (${String(chosen.uom ?? '')})` : 'Received'} required>
            <Input type="number" step="any" inputMode="decimal" min={0} value={form.quantityReceived} onChange={(e) => setForm({ ...form, quantityReceived: e.target.value })} required placeholder="On the challan" />
          </Field>
          <Field label={chosen ? `Accepted (${String(chosen.uom ?? '')})` : 'Accepted'}>
            <Input type="number" step="any" inputMode="decimal" min={0} value={form.quantityAccepted} onChange={(e) => setForm({ ...form, quantityAccepted: e.target.value })} placeholder="Same as received" />
          </Field>
          <Field label={chosen ? `Rate (₹ per ${String(chosen.uom ?? 'unit')})` : 'Rate'}>
            <Input type="number" step="any" inputMode="decimal" min={0} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder={chosen && num(chosen.standardRate) > 0 ? `Standard ${money(chosen.standardRate)}` : '0'} />
          </Field>
          <Field label="Truck">
            <Input value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} placeholder="TN 01 AB 1234" />
          </Field>
          <Field label="Supplier challan no">
            <Input value={form.supplierChallanNo} onChange={(e) => setForm({ ...form, supplierChallanNo: e.target.value })} placeholder="On the delivery note" />
          </Field>
          <div className="mn-mi-form-submit">
            <Button type="submit" icon={<ArrowDownToLine size={14} />} loading={busy} disabled={!form.materialId}>Receive</Button>
            <span className="mn-ord-meta">{received > 0 ? `${qty(accepted)} ${String(chosen?.uom ?? '')} accepted${num(form.rate) > 0 ? ` = ${money(preview)}` : ''}` : 'Creates a draft; post it to add the accepted quantity to stock'}</span>
          </div>
        </Form>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><ArrowDownToLine size={16} aria-hidden /> Inwards <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<ExportButton rows={shown} columns={['inwardNo', 'createdAt', 'supplierName', 'materialLabel', 'vehicleNo', 'supplierChallanNo', 'quantityReceived', 'quantityAccepted', 'uom', 'rate', 'amount', 'status']} filename="material-inwards" />}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : shown.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Inward</span>
              <span>Material · supplier</span>
              <span className="is-num">Accepted</span>
              <span className="is-num">Value</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const status = String(r.status ?? '');
              const rec = num(r.quantityReceived);
              const acc = num(r.quantityAccepted);
              const rejected = Math.max(0, rec - acc);
              const off = rateOff(r);
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts mn-mi-row${status === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(status)}>
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.inwardNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDateTime(r.createdAt)}{r.slipNo ? <><span className="mn-ord-dot" aria-hidden>·</span>slip {String(r.slipNo)}</> : null}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.materialLabel ?? '')}</span>
                    <span className="mn-ord-meta">
                      {String(r.supplierName ?? 'Supplier not recorded')}
                      {r.vehicleNo ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.vehicleNo)}</> : null}
                      {r.supplierChallanNo ? <><span className="mn-ord-dot" aria-hidden>·</span>challan {String(r.supplierChallanNo)}</> : null}
                      {multiPlant && r.plantName ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.plantName)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{qty(acc)} {String(r.uom ?? '')}</span>
                    <span className={`mn-ord-meta${rejected > 0 ? ' mn-mi-rej' : ''}`}>{rejected > 0 ? `${qty(rec)} received, ${qty(rejected)} rejected` : 'all of it accepted'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.amount)}</span>
                    <span className={`mn-ord-meta${off ? ' mn-mi-rate-off' : ''}`}>{num(r.rate) > 0 ? `${money(r.rate)}/${String(r.uom ?? 'unit')}` : 'no rate'}{off ? ` · standard ${money(r.standardRate)}` : ''}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={status} /></div>
                  <div className="mn-ord-act mn-mi-acts">
                    {status === 'draft' ? (
                      <>
                        <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => post(r)} disabled={busy}>Post</Button>
                        <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => cancel(r)} disabled={busy} aria-label={`Cancel ${String(r.inwardNo)}`}>Cancel</Button>
                      </>
                    ) : status === 'posted' ? (
                      <Link href="/app/production/stock" className="mn-ord-meta mn-mi-instock">In stock</Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : filter ? (
          <EmptyState title={`No ${labelOf(filter)} inwards`} description="Press the chip again to show every inward." />
        ) : (
          <EmptyState title="No deliveries yet" description="Receive the first delivery above, or convert a weighbridge slip. Posting it adds the accepted quantity to stock." />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="inwards" />
      </Card>
    </div>
  );
}
