'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, CheckCircle2, ClipboardCheck, Package, Paperclip, Plus, RefreshCw, Scale, Trash2, Truck, XCircle } from 'lucide-react';
import { convertUom, reachableUoms, type UomConversionRow } from '@rmc/shared';
import { formatDateTime } from '../../../../lib/format-date';
import { money } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, materialInwardApi, openAttachment, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
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
 * supplier, truck, challan and bill numbers, what was accepted against what
 * came (with the rejected part called out), the value at the rate keyed
 * (flagged when far from the material's standard rate), the status, who
 * posted it, the attached invoice, and Post / Cancel for a draft. Drafts
 * still to post get a note. The "new inward" form is one truck: a header
 * (plant, supplier, truck, challan and bill numbers) and a line per
 * material on it — unit, received, accepted, rate, value as you type — and
 * posting it writes one numbered inward per line. Same layout in both
 * skins; every colour reads the semantic tokens.
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

const EMPTY_HEAD = { plantId: '', supplierId: '', vehicleNo: '', supplierChallanNo: '', supplierBillNo: '' };
/** `uom` is the unit the figures are keyed in — the material's own, or one convertible from it. */
interface InwardLine { materialId: string; uom: string; quantityReceived: string; quantityAccepted: string; rate: string }
const emptyLine = (): InwardLine => ({ materialId: '', uom: '', quantityReceived: '', quantityAccepted: '', rate: '' });

const INVOICE_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf';
const INVOICE_MAX_BYTES = 3 * 1024 * 1024;

/** Read a File as base64 with no data-URL prefix. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function MaterialInwardPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [conversions, setConversions] = useState<UomConversionRow[]>([]);
  const [filter, setFilter] = useState('');
  const [head, setHead] = useState(EMPTY_HEAD);
  const [lines, setLines] = useState<InwardLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();
  const canAdjust = getAccess().has('stock.adjust');
  // One hidden file input serves every row; the row it is for is remembered here.
  const fileInput = useRef<HTMLInputElement>(null);
  const attachFor = useRef<Row | null>(null);

  const reload = useCallback(async () => {
    const [i, m, s, p, c] = await Promise.all([materialInwardApi.list(undefined, win.limit), crud('materials').list(), crud('suppliers').list(), crud('plants').list(), crud('uom-conversions').list()]);
    setRows(i);
    setMaterials(m);
    setSuppliers(s);
    setPlants(p);
    setConversions(c.map((r) => ({ from: String(r.fromUom ?? ''), to: String(r.toUom ?? ''), factor: num(r.factor) })));
    setHead((h) => (h.plantId || p.length !== 1 ? h : { ...h, plantId: String(p[0]?.id ?? '') }));
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

  // ---- the truck being keyed ----
  const setLine = (i: number, patch: Partial<InwardLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const materialOf = (l: InwardLine) => materials.find((x) => String(x.id) === l.materialId);
  /** The units a line may be keyed in: the material's own plus every unit a conversion reaches. */
  const unitsFor = (l: InwardLine) => reachableUoms(materialOf(l)?.uom as string | undefined, conversions);
  function pickMaterial(i: number, id: string) {
    const m = materials.find((x) => String(x.id) === id);
    // The standard rate is the starting point; the supplier's rate on the challan overrides it.
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, materialId: id, uom: String(m?.uom ?? ''), rate: l.rate || (m && num(m.standardRate) > 0 ? String(num(m.standardRate)) : '') } : l)));
  }
  /** A keyed figure in the material's own unit (the rate and stock are per that unit). */
  const ownQty = (l: InwardLine, v: string) => {
    const own = String(materialOf(l)?.uom ?? '');
    if (!l.uom || !own || l.uom === own) return num(v);
    return convertUom(num(v), l.uom, own, conversions) ?? 0;
  };
  const acceptedOf = (l: InwardLine) => (l.quantityAccepted === '' ? l.quantityReceived : l.quantityAccepted);
  const lineValue = (l: InwardLine) => ownQty(l, acceptedOf(l)) * num(l.rate);
  const liveLines = lines.filter((l) => l.materialId && num(l.quantityReceived) > 0);
  const formValue = liveLines.reduce((t, l) => t + lineValue(l), 0);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!liveLines.length) { setError('Add at least one line with the material and the quantity received.'); return; }
    for (const l of liveLines) {
      if (num(acceptedOf(l)) < 0 || num(acceptedOf(l)) > num(l.quantityReceived) + 0.0005) { setError(`Accepted cannot be more than received for ${String(materialOf(l)?.materialName ?? 'a line')}.`); return; }
    }
    await run(async () => {
      const created = await materialInwardApi.createBatch({
        plantId: head.plantId || undefined,
        supplierId: head.supplierId || undefined,
        vehicleNo: head.vehicleNo.trim() || undefined,
        supplierChallanNo: head.supplierChallanNo.trim() || undefined,
        supplierBillNo: head.supplierBillNo.trim() || undefined,
        lines: liveLines.map((l) => {
          const own = String(materialOf(l)?.uom ?? '');
          const other = l.uom && own && l.uom !== own;
          return {
            materialId: l.materialId,
            ...(other ? { enteredUom: l.uom } : {}),
            quantityReceived: num(l.quantityReceived),
            quantityAccepted: l.quantityAccepted === '' ? undefined : num(l.quantityAccepted),
            rate: num(l.rate),
          };
        }),
      });
      setHead((h) => ({ ...EMPTY_HEAD, plantId: h.plantId }));
      setLines([emptyLine()]);
      const nos = created.map((r) => String(r.inwardNo ?? '')).filter(Boolean).join(', ');
      return created.length === 1
        ? `${nos} created as a draft. Post it to add the accepted quantity to stock.`
        : `${created.length} inwards created as drafts (${nos}). Post each one to add its accepted quantity to stock.`;
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

  // ---- the supplier's invoice on a row ----
  function chooseInvoice(r: Row) {
    attachFor.current = r;
    if (fileInput.current) fileInput.current.value = '';
    fileInput.current?.click();
  }
  async function invoiceChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const r = attachFor.current;
    if (!file || !r) return;
    if (file.size > INVOICE_MAX_BYTES) { setError('The invoice must be 3 MB or smaller. A phone photo at a lower quality setting, or the PDF, will fit.'); return; }
    await run(async () => {
      const data = await fileToBase64(file);
      await materialInwardApi.attach(String(r.id), { name: file.name, mime: file.type || 'application/pdf', data });
      return `Invoice ${file.name} attached to ${String(r.inwardNo)}.`;
    });
  }
  async function removeInvoice(r: Row) {
    if (!(await confirm({ title: 'Remove invoice', message: `Remove the attached invoice from ${String(r.inwardNo)}? The inward itself stays as it is.`, confirmLabel: 'Remove invoice', danger: true }))) return;
    await run(() => materialInwardApi.removeAttachment(String(r.id)), `Invoice removed from ${String(r.inwardNo)}.`);
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
          <div className="mn-mi-head">
            {multiPlant && (
              <Field label="Plant">
                <Select value={head.plantId} onChange={(e) => setHead({ ...head, plantId: e.target.value })}>
                  <option value="">Pick the plant</option>
                  {plants.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Supplier" help={suppliers.length ? undefined : 'No suppliers yet: add them under Masters → Suppliers'}>
              <Select value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}>
                <option value="">{suppliers.length ? 'Pick the supplier' : 'No suppliers set up'}</option>
                {suppliers.map((s) => (
                  <option key={String(s.id)} value={String(s.id)}>{String(s.supplierName)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Truck">
              <Input value={head.vehicleNo} onChange={(e) => setHead({ ...head, vehicleNo: e.target.value })} placeholder="TN 01 AB 1234" />
            </Field>
            <Field label="Supplier challan no">
              <Input value={head.supplierChallanNo} onChange={(e) => setHead({ ...head, supplierChallanNo: e.target.value })} placeholder="On the delivery note" />
            </Field>
            <Field label="Supplier bill no" help="When the invoice travels with the load.">
              <Input value={head.supplierBillNo} onChange={(e) => setHead({ ...head, supplierBillNo: e.target.value })} placeholder="On the supplier's invoice" />
            </Field>
          </div>
          <div className="mn-mi-lines">
            <div className="mn-mi-line mn-mi-line--head" aria-hidden>
              <span>Material</span>
              <span>Unit</span>
              <span className="is-num">Received</span>
              <span className="is-num">Accepted</span>
              <span className="is-num">Rate</span>
              <span className="is-num">Line value</span>
              <span />
            </div>
            {lines.map((l, i) => {
              const mt = materialOf(l);
              const units = unitsFor(l);
              const own = String(mt?.uom ?? '');
              const converted = l.uom && own && l.uom !== own;
              return (
                <div key={i} className="mn-mi-line">
                  <Select value={l.materialId} onChange={(e) => pickMaterial(i, e.target.value)} aria-label="Material">
                    <option value="">Pick the material</option>
                    {materials.map((m) => (
                      <option key={String(m.id)} value={String(m.id)}>{String(m.materialName)}{m.uom ? ` (${String(m.uom)})` : ''}</option>
                    ))}
                  </Select>
                  <Select value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })} aria-label="Unit" disabled={units.length <= 1} title={units.length > 1 ? 'The material\'s own unit, or one a conversion reaches' : own ? `Stocked in ${own}; add a unit conversion to receive in another unit` : 'Pick a material first'}>
                    {!units.length && <option value="">unit</option>}
                    {units.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                  <Input type="number" step="any" inputMode="decimal" min={0} className="is-num" value={l.quantityReceived} onChange={(e) => setLine(i, { quantityReceived: e.target.value })} placeholder={l.uom || own || 'On the challan'} aria-label="Received" title={converted && num(l.quantityReceived) > 0 ? `${qty(ownQty(l, l.quantityReceived))} ${own}` : undefined} />
                  <Input type="number" step="any" inputMode="decimal" min={0} className="is-num" value={l.quantityAccepted} onChange={(e) => setLine(i, { quantityAccepted: e.target.value })} placeholder="Same as received" aria-label="Accepted" />
                  <Input type="number" step="any" inputMode="decimal" min={0} className="is-num" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder={own ? `₹ per ${own}` : '₹ per unit'} aria-label="Rate" title={mt && num(mt.standardRate) > 0 ? `Standard ${money(mt.standardRate)} per ${own || 'unit'}` : undefined} />
                  <span className="mn-mi-line-value is-num" title={converted && num(l.quantityReceived) > 0 ? `${qty(ownQty(l, acceptedOf(l)))} ${own} accepted` : undefined}>{lineValue(l) > 0 ? money(lineValue(l)) : '—'}</span>
                  <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} />
                </div>
              );
            })}
          </div>
          <div className="mn-mi-form-submit">
            <Button type="button" variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setLines((p) => [...p, emptyLine()])}>Add line</Button>
            <Button type="submit" icon={<ArrowDownToLine size={14} />} loading={busy} disabled={!liveLines.length}>Receive</Button>
            <span className="mn-ord-meta">{liveLines.length ? `${liveLines.length} ${liveLines.length === 1 ? 'line' : 'lines'}${formValue > 0 ? ` = ${money(formValue)}` : ''}; one draft inward per line. Post each to add its accepted quantity to stock.` : 'Creates a draft inward per line; post each to add the accepted quantity to stock. The rate is per the material\'s own unit; pick another unit on a line to key the challan figure in bags or litres where a conversion is set up.'}</span>
          </div>
        </Form>
      </Card>

      <input ref={fileInput} type="file" accept={INVOICE_ACCEPT} className="mn-mi-file" aria-hidden tabIndex={-1} onChange={invoiceChosen} />

      <Card
        title={<span className="mn-board-card-title"><ArrowDownToLine size={16} aria-hidden /> Inwards <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<ExportButton rows={shown} columns={['inwardNo', 'createdAt', 'supplierName', 'materialLabel', 'vehicleNo', 'supplierChallanNo', 'supplierBillNo', 'quantityReceived', 'quantityAccepted', 'uom', 'enteredQuantity', 'enteredUom', 'rate', 'amount', 'status', 'postedByName']} filename="material-inwards" />}
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
              const hasInvoice = r.hasAttachment === true;
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts mn-mi-row${status === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(status)}>
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.inwardNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDateTime(r.createdAt)}{r.slipNo ? <><span className="mn-ord-dot" aria-hidden>·</span>slip {String(r.slipNo)}</> : null}</span>
                    {status === 'posted' && r.postedByName ? <span className="mn-ord-meta mn-mi-by">Posted by {String(r.postedByName)}</span> : null}
                    {hasInvoice ? (
                      <button type="button" className="mn-ord-meta mn-mi-instock" onClick={() => openAttachment(`/material-inwards/${String(r.id)}/attachment`, r.attachmentName ? String(r.attachmentName) : null).catch((e) => setError(String(e)))} title={r.attachmentName ? String(r.attachmentName) : 'Open the attached invoice'}>
                        <Paperclip size={12} aria-hidden /> Invoice
                      </button>
                    ) : null}
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.materialLabel ?? '')}</span>
                    <span className="mn-ord-meta">
                      {String(r.supplierName ?? 'Supplier not recorded')}
                      {r.vehicleNo ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.vehicleNo)}</> : null}
                      {r.supplierChallanNo ? <><span className="mn-ord-dot" aria-hidden>·</span>challan {String(r.supplierChallanNo)}</> : null}
                      {r.supplierBillNo ? <><span className="mn-ord-dot" aria-hidden>·</span>bill {String(r.supplierBillNo)}</> : null}
                      {multiPlant && r.plantName ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.plantName)}</> : null}
                    </span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{qty(acc)} {String(r.uom ?? '')}</span>
                    <span className={`mn-ord-meta${rejected > 0 ? ' mn-mi-rej' : ''}`}>{rejected > 0 ? `${qty(rec)} received, ${qty(rejected)} rejected` : 'all of it accepted'}{r.enteredUom && r.enteredQuantity != null ? ` · keyed as ${qty(r.enteredQuantity)} ${String(r.enteredUom)}` : ''}</span>
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
                      <>
                        <Link href="/app/production/stock" className="mn-ord-meta mn-mi-instock">In stock</Link>
                        {canAdjust && (
                          <Button size="sm" variant="ghost" icon={<Paperclip size={14} />} onClick={() => chooseInvoice(r)} disabled={busy} aria-label={`${hasInvoice ? 'Replace' : 'Attach'} invoice on ${String(r.inwardNo)}`}>{hasInvoice ? 'Replace invoice' : 'Attach invoice'}</Button>
                        )}
                        {canAdjust && hasInvoice && (
                          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => removeInvoice(r)} disabled={busy} aria-label={`Remove invoice from ${String(r.inwardNo)}`}>Remove</Button>
                        )}
                      </>
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
