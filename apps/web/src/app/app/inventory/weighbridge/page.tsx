'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, CheckCircle2, Cpu, Download, Plug, Plus, RefreshCw, Scale, Truck, XCircle } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, dispatchApi, openPdf, weighbridgeApi, weighbridgeIndicatorApi, type Row } from '../../../../lib/api';
import { chooseSerialPort, readSerialFrames, serialSupported } from '../../../../lib/serial-reader';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Weighbridge — every truck weighed at the gate.
 *
 * A status strip (weighing / weighed / converted / mismatch / cancelled)
 * with live counts doubles as the filter, a summary pill totals the net
 * weight on screen, and each slip is one row: number and time, the truck
 * with the supplier and challan, the material, the net weight with gross
 * and tare and where the weights came from, the status with the inward it
 * became, and the actions the state allows (Slip, Complete weighing, To
 * inward, Cancel). Notes flag weighed slips not yet converted and slips
 * still being weighed. The "new slip" form reads gross and tare off the
 * indicator or takes them by hand and shows the net as you type; the
 * indicators card below manages the scale heads. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const kg = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const tonnes = (v: unknown) => (num(v) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Weighing', tone: 'warning', hint: 'First weight taken; press Second weight when the truck crosses the bridge again' },
  { key: 'completed', label: 'Weighed', tone: 'info', hint: 'Both weights in; convert it to a material inward so the load reaches stock' },
  { key: 'matched', label: 'Converted', tone: 'success', hint: 'Turned into a material inward; post that to add the load to stock' },
  { key: 'mismatch', label: 'Mismatch', tone: 'danger', hint: 'The weights did not reconcile with the challan; sort it out with the supplier' },
  { key: 'cancelled', label: 'Cancelled', tone: 'neutral', hint: 'Void; nothing reaches stock from it' },
];
const toneOf = (status: string): Tone => STATUSES.find((s) => s.key === status)?.tone ?? 'neutral';
const labelOf = (status: string) => STATUSES.find((s) => s.key === status)?.label.toLowerCase() ?? status;
const sourceOf = (r: Row) => (String(r.weightSource) === 'device' ? (r.manualOverride ? `${String(r.indicatorName ?? 'indicator')}, adjusted by hand` : `off ${String(r.indicatorName ?? 'the indicator')}`) : 'keyed by hand');

// The truck is picked from the vehicle master (fleet and hired trucks); a
// supplier's truck that is not in the master is typed under "Other truck".
const OTHER_TRUCK = '__other__';
const EMPTY = { plantId: '', supplierId: '', materialId: '', truckPick: '', vehicleNo: '', supplierChallanNo: '', firstWeight: '', secondWeight: '' };
// Provenance for the hardware bridge: which weights came off the indicator,
// and whether the operator hand-edited a device reading afterwards.
const NO_CAPTURE = { firstFromDevice: false, secondFromDevice: false, overridden: false };
/** Dispatch stages where the truck is out with concrete, or about to be: it shows at the top of the truck list. */
const LIVE_DISPATCH = ['waiting', 'loaded', 'left_plant', 'reached_site', 'pouring', 'delayed', 'returning'];

export default function WeighbridgePage() {
  const { prompt, confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [indicators, setIndicators] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [dispatches, setDispatches] = useState<Row[]>([]);
  // Settings → "Weights only from the indicator": when on, the figures come
  // off the indicator alone and the API checks them against its readings.
  const [indicatorOnly, setIndicatorOnly] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [indicatorId, setIndicatorId] = useState('');
  const [capture, setCapture] = useState(NO_CAPTURE);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [w, m, s, p, ind, v, d, pol] = await Promise.all([
      weighbridgeApi.list(undefined, win.limit),
      crud('materials').list(),
      crud('suppliers').list(),
      crud('plants').list(),
      weighbridgeIndicatorApi.list().catch(() => [] as Row[]),
      // The truck list and the trucks out on dispatch only label the picker, so
      // a hiccup there must not blank the weighbridge.
      crud('vehicles').list().catch(() => [] as Row[]),
      dispatchApi.list().catch(() => [] as Row[]),
      weighbridgeApi.policy().catch(() => ({ indicatorOnly: false, readingWindowMinutes: 15 })),
    ]);
    setRows(w);
    setMaterials(m);
    setSuppliers(s);
    setPlants(p);
    setIndicators(ind);
    setVehicles(v);
    setDispatches(d);
    setIndicatorOnly(!!pol.indicatorOnly);
    setIndicatorId((cur) => cur || (ind[0] ? String(ind[0].id) : ''));
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

  // ---- live "Get weight" read off the selected indicator ----
  async function getWeight(target: 'first' | 'second') {
    setError(null);
    setMsg(null);
    if (!indicatorId) {
      setError('Pick a weighbridge indicator first, or add one in the Indicators card below.');
      return;
    }
    try {
      // A serial indicator is plugged into this PC: the browser reads the COM
      // port and hands the raw frames to the server, which parses them like
      // every other source. Needs Chrome or Edge.
      const device = indicators.find((d) => String(d.id) === indicatorId);
      let rawFrames: string[] | undefined;
      if (device && String(device.connectionType) === 'serial') {
        if (!serialSupported()) {
          setError('This indicator is read over the COM port, which needs Chrome or Edge on the weighbridge PC.');
          return;
        }
        rawFrames = await readSerialFrames({ baudRate: Number(device.baudRate ?? 9600) });
      }
      const reading = await weighbridgeIndicatorApi.read(indicatorId, rawFrames);
      const w = String(reading.weightKg);
      if (target === 'first') {
        setForm((f) => ({ ...f, firstWeight: w }));
        setCapture((c) => ({ ...c, firstFromDevice: true }));
      } else {
        setForm((f) => ({ ...f, secondWeight: w }));
        setCapture((c) => ({ ...c, secondFromDevice: true }));
      }
      setMsg(`${reading.indicatorName}: ${kg(reading.weightKg)} kg${reading.stable ? '' : ' (not yet stable; read again)'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Indicator read failed');
    }
  }

  // A hand-edit of a device-captured field is a manual override (kept on the slip).
  function onWeightChange(target: 'first' | 'second', x: string) {
    if (indicatorOnly) return; // the figure comes off the indicator alone
    if (target === 'first') {
      setForm((f) => ({ ...f, firstWeight: x }));
      setCapture((c) => (c.firstFromDevice ? { ...c, overridden: true } : c));
    } else {
      setForm((f) => ({ ...f, secondWeight: x }));
      setCapture((c) => (c.secondFromDevice ? { ...c, overridden: true } : c));
    }
  }

  // Whichever weighing came first, the heavier reading is the gross, the
  // lighter the tare, and the net is the difference: a supplier truck comes
  // in loaded and leaves empty; a transit mixer leaves loaded and comes back
  // empty. The slip is saved after the first weight and completed by the second.
  const first = num(form.firstWeight);
  const second = num(form.secondWeight);
  const gross = second > 0 ? Math.max(first, second) : first;
  const tare = second > 0 ? Math.min(first, second) : 0;
  const net = Math.max(0, gross - tare);
  const usedDevice = capture.firstFromDevice || capture.secondFromDevice;
  const chosen = materials.find((x) => String(x.id) === form.materialId);

  // The truck picker: trucks out on a live dispatch first (the loaded mixer
  // about to cross the bridge), then the rest of the active fleet, then
  // "Other truck" for a supplier's vehicle that is not in the master.
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [String(v.id), v])), [vehicles]);
  const onDispatch = useMemo(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const d of dispatches) {
      if (!LIVE_DISPATCH.includes(String(d.dispatchStatus))) continue;
      const v = d.vehicleId ? vehicleById.get(String(d.vehicleId)) : undefined;
      if (!v || seen.has(String(v.id))) continue;
      seen.add(String(v.id));
      out.push({ ...v, dispatchNo: d.dispatchNo, dispatchStatus: d.dispatchStatus });
    }
    return out;
  }, [dispatches, vehicleById]);
  const fleet = useMemo(() => {
    const busy = new Set(onDispatch.map((v) => String(v.id)));
    return vehicles
      .filter((v) => !busy.has(String(v.id)) && String(v.status ?? 'available') !== 'inactive')
      .sort((a, b) => String(a.vehicleNo).localeCompare(String(b.vehicleNo)));
  }, [vehicles, onDispatch]);
  const truckNo = form.truckPick === OTHER_TRUCK ? form.vehicleNo.trim() : String(vehicleById.get(form.truckPick)?.vehicleNo ?? '');

  function pickTruck(value: string) {
    setForm((f) => ({ ...f, truckPick: value, vehicleNo: value === OTHER_TRUCK ? f.vehicleNo : '' }));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!(first > 0)) { setError(indicatorOnly ? 'Press Get with the truck on the bridge to read the first weight.' : 'Enter the first weight.'); return; }
    if (indicatorOnly && (!capture.firstFromDevice || (second > 0 && !capture.secondFromDevice))) { setError('Weights only from the indicator is on: every weight must be read with Get.'); return; }
    if (second > 0 && second === first) { setError('The second weight equals the first, so the net would be zero. Check the reading.'); return; }
    await run(async () => {
      const created = (await weighbridgeApi.create({
        plantId: form.plantId || undefined,
        supplierId: form.supplierId || undefined,
        materialId: form.materialId || undefined,
        vehicleNo: truckNo || undefined,
        supplierChallanNo: form.supplierChallanNo.trim() || undefined,
        grossWeight: gross,
        tareWeight: tare,
        weightSource: usedDevice ? 'device' : 'manual',
        indicatorId: usedDevice ? indicatorId : undefined,
        manualOverride: usedDevice && capture.overridden,
      })) as Row;
      setForm((f) => ({ ...EMPTY, plantId: f.plantId }));
      setCapture(NO_CAPTURE);
      return `${String(created?.slipNo ?? 'Slip')} saved${second > 0 ? `: ${kg(net)} kg net. Press Complete weighing, then convert it to an inward.` : ` with the first weight (${kg(first)} kg). When the truck crosses the bridge again, press Second weight on the slip.`}`;
    });
  }

  async function complete(r: Row) {
    if (!(num(r.tareWeight) > 0)) {
      setError(`${String(r.slipNo)} has only its first weight. Press Second weight when the truck crosses the bridge again.`);
      return;
    }
    await run(() => weighbridgeApi.setStatus(String(r.id), 'completed'), `${String(r.slipNo)} weighed: ${kg(r.netWeight)} kg net. Press To inward to book it.`);
  }

  /** The truck is back on the bridge: read or key its second weight; the slip works out gross, tare and net. */
  async function secondWeight(r: Row) {
    setError(null);
    const firstKg = num(r.grossWeight) > 0 ? num(r.grossWeight) : num(r.tareWeight);
    let fromDevice = false;
    let reading = '';
    const device = indicators.find((d) => String(d.id) === indicatorId);
    if (indicatorOnly && !device) { setError('Weights only from the indicator is on, but no indicator is set up. Add one in the Indicators card below.'); return; }
    if (device) {
      try {
        let rawFrames: string[] | undefined;
        if (String(device.connectionType) === 'serial') {
          if (!serialSupported()) throw new Error('This indicator is read over the COM port, which needs Chrome or Edge on the weighbridge PC.');
          rawFrames = await readSerialFrames({ baudRate: Number(device.baudRate ?? 9600) });
        }
        const got = await weighbridgeIndicatorApi.read(indicatorId, rawFrames);
        reading = String(got.weightKg);
        fromDevice = true;
      } catch (e) {
        if (indicatorOnly) { setError(e instanceof Error ? e.message : 'Indicator read failed'); return; }
        setMsg(`${e instanceof Error ? e.message : 'Indicator read failed'} Key the weight by hand.`);
      }
    }
    if (indicatorOnly) {
      // The reading is shown for confirmation and cannot be edited.
      const go = await confirm({
        title: `Second weight for ${String(r.slipNo)}`,
        message: `${String(device?.name ?? 'Indicator')} reads ${kg(reading)} kg. First weight ${kg(firstKg)} kg${r.vehicleNo ? ` for ${String(r.vehicleNo)}` : ''}; the heavier becomes the gross, the lighter the tare. Save this as the second weight?`,
        confirmLabel: 'Save second weight',
      });
      if (!go) return;
      await run(async () => {
        const out = (await weighbridgeApi.secondWeight(String(r.id), { weight: num(reading), weightSource: 'device', indicatorId, manualOverride: false })) as Row;
        return `${String(r.slipNo)} weighed: ${kg(out?.netWeight)} kg net (${kg(out?.grossWeight)} − ${kg(out?.tareWeight)}). Press To inward to book it.`;
      });
      return;
    }
    const typed = await prompt({
      title: `Second weight for ${String(r.slipNo)}`,
      message: `First weight ${kg(firstKg)} kg${r.vehicleNo ? ` for ${String(r.vehicleNo)}` : ''}. The heavier reading becomes the gross, the lighter the tare, and the net is the difference.`,
      label: 'Second weight (kg)',
      defaultValue: reading,
      type: 'number',
    });
    if (typed === null) return;
    const weight = num(typed);
    if (!(weight > 0)) { setError('Enter the second weight in kg.'); return; }
    const overridden = fromDevice && String(typed).trim() !== reading;
    await run(async () => {
      const out = (await weighbridgeApi.secondWeight(String(r.id), {
        weight,
        weightSource: fromDevice ? 'device' : 'manual',
        indicatorId: fromDevice ? indicatorId : undefined,
        manualOverride: overridden,
      })) as Row;
      return `${String(r.slipNo)} weighed: ${kg(out?.netWeight)} kg net (${kg(out?.grossWeight)} − ${kg(out?.tareWeight)}). Press To inward to book it.`;
    });
  }

  async function toInward(r: Row) {
    const std = materials.find((x) => String(x.id) === String(r.materialId ?? ''));
    const rate = await prompt({
      title: 'Convert to material inward',
      message: `${kg(r.netWeight)} kg net of ${String(r.materialLabel ?? 'material')} becomes a draft inward in the material's stock unit${r.materialUom ? ` (${String(r.materialUom)})` : ''}. Enter the supplier's rate per unit; you can post the inward from Material inward.`,
      label: r.materialUom ? `Rate (₹ per ${String(r.materialUom)})` : 'Rate per unit',
      defaultValue: std && num(std.standardRate) > 0 ? String(num(std.standardRate)) : '0',
      type: 'number',
    });
    if (rate === null) return;
    await run(async () => {
      const out = (await weighbridgeApi.toInward(String(r.id), Number(rate || 0))) as Row;
      const inw = out?.inward as Row | undefined;
      return `${String(r.slipNo)} converted to ${String(inw?.inwardNo ?? 'a draft inward')}: ${inw ? `${num(inw.quantityReceived).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${String(inw.uom ?? '')}` : ''} waiting to be posted under Material inward.`;
    });
  }

  async function cancel(r: Row) {
    if (!(await confirm({ title: 'Cancel slip', message: `Cancel ${String(r.slipNo)}? The weighing is voided; nothing reaches stock from it.`, confirmLabel: 'Cancel slip', danger: true }))) return;
    await run(() => weighbridgeApi.setStatus(String(r.id), 'cancelled'), `${String(r.slipNo)} cancelled.`);
  }

  const shown = filter ? rows.filter((r) => String(r.status) === filter) : rows;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.status), (m.get(String(r.status)) ?? 0) + 1);
    return m;
  }, [rows]);
  const netTotal = useMemo(() => shown.reduce((t, r) => (String(r.status) === 'cancelled' ? t : t + num(r.netWeight)), 0), [shown]);
  const weighed = counts.get('completed') ?? 0;
  const weighing = counts.get('draft') ?? 0;
  const multiPlant = plants.length > 1;

  return (
    <div className="mn-ord mn-wb">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Weighbridge</h1>
          <p>Every truck weighed at the gate: gross in, tare out, and the net that becomes stock once the slip is converted to a material inward. Read the weights off the indicator, or key them by hand.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Scale size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'slip' : 'slips'}
            {' · '}
            {tonnes(netTotal)} t net
          </span>
          <Link href="/app/inventory/inward" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<ArrowDownToLine size={14} />}>Material inward</Button>
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

      {(weighed > 0 || weighing > 0) && !filter && (
        <div className="mn-ord-notes">
          {weighed > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('completed')}>
              <ArrowDownToLine size={16} aria-hidden />
              <span><strong>{weighed} weighed {weighed === 1 ? 'slip is' : 'slips are'} not converted to an inward yet.</strong> Stock does not know about {weighed === 1 ? 'that load' : 'those loads'} until each slip becomes an inward and the inward is posted.</span>
            </button>
          )}
          {weighing > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--btn" onClick={() => setFilter('draft')}>
              <Scale size={16} aria-hidden />
              <span><strong>{weighing} {weighing === 1 ? 'slip is' : 'slips are'} still being weighed.</strong> Once both weights are on the slip, press Complete weighing.</span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> New slip</span>} actions={indicatorOnly ? <span className="mn-ord-how"><Scale size={13} aria-hidden /> Weights only from the indicator</span> : undefined}>
        {indicatorOnly && !indicators.length && (
          <div className="mn-ord-note mn-ord-note--warn" role="status"><Scale size={16} aria-hidden /><span><strong>Weights only from the indicator is on, but no indicator is set up.</strong> Add one in the Indicators card below, or turn the setting off under Settings.</span></div>
        )}
        <Form onSubmit={create} className="mn-wb-form">
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
          <Field label="Truck" help={form.truckPick === OTHER_TRUCK ? 'A supplier truck that is not in Masters → Vehicles.' : onDispatch.length ? 'Trucks out on a dispatch are listed first.' : undefined}>
            <Select value={form.truckPick} onChange={(e) => pickTruck(e.target.value)}>
              <option value="">{vehicles.length ? 'Pick the truck' : 'No vehicles in the master yet'}</option>
              {onDispatch.length > 0 && (
                <optgroup label="On dispatch now">
                  {onDispatch.map((v) => (
                    <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)} · {String(v.dispatchNo ?? '')} {String(v.dispatchStatus ?? '').replace(/_/g, ' ')}</option>
                  ))}
                </optgroup>
              )}
              {fleet.length > 0 && (
                <optgroup label="Fleet">
                  {fleet.map((v) => (
                    <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}{v.vehicleType ? ` · ${String(v.vehicleType).replace(/_/g, ' ')}` : ''}</option>
                  ))}
                </optgroup>
              )}
              <option value={OTHER_TRUCK}>Other truck (type the number)</option>
            </Select>
            {form.truckPick === OTHER_TRUCK && (
              <Input value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} placeholder="TN 01 AB 1234" aria-label="Truck number" autoFocus />
            )}
          </Field>
          <Field label="Supplier" help={suppliers.length ? undefined : 'No suppliers yet: add them under Masters → Suppliers'}>
            <Select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">{suppliers.length ? 'Pick the supplier' : 'No suppliers set up'}</option>
              {suppliers.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>{String(s.supplierName)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Material">
            <Select value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })}>
              <option value="">Pick the material</option>
              {materials.map((m) => (
                <option key={String(m.id)} value={String(m.id)}>{String(m.materialName)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier challan no">
            <Input value={form.supplierChallanNo} onChange={(e) => setForm({ ...form, supplierChallanNo: e.target.value })} placeholder="On the delivery note" />
          </Field>
          {indicators.length > 0 && (
            <Field label="Indicator">
              <Select value={indicatorId} onChange={(e) => setIndicatorId(e.target.value)}>
                {indicators.map((d) => (
                  <option key={String(d.id)} value={String(d.id)}>{String(d.name)}{d.isActive === false ? ' (inactive)' : ''}</option>
                ))}
              </Select>
              {indicators.some((d) => String(d.id) === indicatorId && String(d.connectionType) === 'serial') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<Plug size={14} />}
                  title="Pick the COM port the indicator is plugged into (the browser remembers it)"
                  onClick={async () => {
                    setError(null);
                    if (!serialSupported()) { setError('Choosing a COM port needs Chrome or Edge on the weighbridge PC.'); return; }
                    if (await chooseSerialPort()) setMsg('COM port chosen. Press Get to read the weight.');
                  }}
                >
                  COM port
                </Button>
              )}
            </Field>
          )}
          <Field label="First weight (kg)" required help={indicatorOnly ? 'Read off the indicator with Get; it cannot be typed.' : 'Loaded for a supplier truck coming in; empty for a mixer going out.'}>
            <div className="mn-wb-weigh">
              <Input type="number" step="any" inputMode="decimal" min={0} value={form.firstWeight} onChange={(e) => onWeightChange('first', e.target.value)} required readOnly={indicatorOnly} placeholder={indicatorOnly ? 'Press Get' : 'On the bridge now'} />
              <Button type="button" variant="secondary" size="sm" icon={<Scale size={14} />} onClick={() => getWeight('first')} disabled={!indicators.length} title={indicators.length ? 'Read the weight off the indicator' : 'Add an indicator below to read weights'}>Get</Button>
            </div>
          </Field>
          <Field label="Second weight (kg)" help="Leave blank if the truck is weighed again later; the slip then takes it from Second weight on the row.">
            <div className="mn-wb-weigh">
              <Input type="number" step="any" inputMode="decimal" min={0} value={form.secondWeight} onChange={(e) => onWeightChange('second', e.target.value)} readOnly={indicatorOnly} placeholder={indicatorOnly ? 'Press Get when it crosses again' : 'When it crosses again'} />
              <Button type="button" variant="secondary" size="sm" icon={<Scale size={14} />} onClick={() => getWeight('second')} disabled={!indicators.length} title={indicators.length ? 'Read the weight off the indicator' : 'Add an indicator below to read weights'}>Get</Button>
            </div>
          </Field>
          <div className="mn-wb-form-submit">
            <Button type="submit" icon={<Plus size={14} />} loading={busy} disabled={!(first > 0)}>Save slip</Button>
            <span className="mn-wb-net" aria-live="polite">
              {first > 0 ? (
                <>
                  <strong>{second > 0 ? `${kg(net)} kg net` : `${kg(first)} kg first weight`}</strong>
                  <span className="mn-ord-meta">{second > 0 ? `${kg(gross)} gross − ${kg(tare)} tare${chosen?.uom && String(chosen.uom).toLowerCase().startsWith('ton') ? ` = ${tonnes(net)} t` : ''}` : 'net is worked out once the second weight is in'}{usedDevice ? ` · ${capture.overridden ? 'read off the indicator, adjusted by hand' : 'read off the indicator'}` : ''}</span>
                </>
              ) : (
                <span className="mn-ord-meta">Net is the difference between the two weighings; the heavier one is the gross.</span>
              )}
            </span>
          </div>
        </Form>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Scale size={16} aria-hidden /> Slips <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<ExportButton rows={shown} columns={['slipNo', 'entryDatetime', 'vehicleNo', 'supplierName', 'materialLabel', 'supplierChallanNo', 'grossWeight', 'tareWeight', 'netWeight', 'weightSource', 'status', 'inwardNo']} filename="weighbridge-slips" />}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : shown.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Slip</span>
              <span>Truck · supplier</span>
              <span>Material</span>
              <span className="is-num">Net</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => {
              const status = String(r.status ?? '');
              const hasTare = num(r.tareWeight) > 0;
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts mn-wb-row${status === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(status)}>
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.slipNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDateTime(r.entryDatetime ?? r.createdAt)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.vehicleNo ?? 'Truck not recorded')}</span>
                    <span className="mn-ord-meta">
                      {String(r.supplierName ?? 'Supplier not recorded')}
                      {r.supplierChallanNo ? <><span className="mn-ord-dot" aria-hidden>·</span>challan {String(r.supplierChallanNo)}</> : null}
                    </span>
                  </div>
                  <div className="mn-wb-mat">
                    <span className="mn-ord-cust">{String(r.materialLabel ?? 'No material')}</span>
                    <span className="mn-ord-meta">{sourceOf(r)}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{hasTare ? `${kg(r.netWeight)} kg` : `${kg(r.grossWeight)} kg`}</span>
                    <span className="mn-ord-meta">{hasTare ? `${kg(r.grossWeight)} − ${kg(r.tareWeight)}` : 'first weight; second still to come'}</span>
                  </div>
                  <div className="mn-ord-status mn-wb-status">
                    <StatusBadge status={status} />
                    {r.inwardId ? <Link href="/app/inventory/inward" className="mn-ord-meta mn-wb-inward">{String(r.inwardNo)}{r.inwardStatus ? ` · ${String(r.inwardStatus)}` : ''}</Link> : null}
                  </div>
                  <div className="mn-ord-act mn-wb-acts">
                    <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/weighbridge/${String(r.id)}/slip`, String(r.slipNo ?? 'slip')).catch((e) => setError(String(e)))} aria-label={`Print ${String(r.slipNo)}`}>Slip</Button>
                    {status === 'draft' && !hasTare && <Button size="sm" variant="secondary" icon={<Scale size={14} />} onClick={() => secondWeight(r)} disabled={busy}>Second weight</Button>}
                    {status === 'draft' && hasTare && <Button size="sm" variant="secondary" icon={<CheckCircle2 size={14} />} onClick={() => complete(r)} disabled={busy}>Complete weighing</Button>}
                    {(status === 'completed' || status === 'mismatch') && !r.inwardId && <Button size="sm" icon={<ArrowDownToLine size={14} />} onClick={() => toInward(r)} disabled={busy || !r.materialId} title={r.materialId ? undefined : 'The slip has no material; it cannot become an inward'}>To inward</Button>}
                    {(status === 'draft' || status === 'completed' || status === 'mismatch') && <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => cancel(r)} disabled={busy} aria-label={`Cancel ${String(r.slipNo)}`}>Cancel</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : filter ? (
          <EmptyState title={`No ${labelOf(filter)} slips`} description="Press the chip again to show every slip." />
        ) : (
          <EmptyState title="No trucks weighed yet" description="Pick the truck and take its first weight above; the second weighing completes the slip and the net becomes a material inward." />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="slips" />
      </Card>

      <IndicatorCard indicators={indicators} plants={plants} busy={busy} onDone={(m) => run(async () => m)} onError={setError} />
    </div>
  );
}

// ---- Indicator device management ----
function IndicatorCard({ indicators, plants, busy, onDone, onError }: { indicators: Row[]; plants: Row[]; busy: boolean; onDone: (msg: string) => void; onError: (e: string) => void }) {
  const [dev, setDev] = useState({ name: '', plantId: '', connectionType: 'simulated', simulatedWeightKg: '25000', host: '', port: '', comPort: '', baudRate: '9600' });

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const body: Record<string, unknown> = { name: dev.name.trim(), plantId: dev.plantId || undefined, connectionType: dev.connectionType };
      if (dev.connectionType === 'simulated') body.simulatedWeightKg = Number(dev.simulatedWeightKg || 0);
      if (dev.connectionType === 'tcp') { body.host = dev.host; body.port = Number(dev.port || 0); }
      if (dev.connectionType === 'serial') { body.comPort = dev.comPort; body.baudRate = Number(dev.baudRate || 0); }
      await weighbridgeIndicatorApi.create(body);
      setDev({ name: '', plantId: '', connectionType: 'simulated', simulatedWeightKg: '25000', host: '', port: '', comPort: '', baudRate: '9600' });
      onDone(`Indicator "${String(body.name)}" added; the Get buttons above read from it.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add indicator');
    }
  }

  return (
    <Card title={<span className="mn-board-card-title"><Cpu size={16} aria-hidden /> Indicators <span className="mn-board-card-count">{indicators.length}</span></span>}>
      <p className="mn-board-form-hint" style={{ margin: '0 0 12px' }}>
        The scale head the plant reads weights from. A <strong>simulated</strong> one returns a fixed demo weight; a <strong>TCP</strong> one is read over the network; a <strong>serial</strong> one is plugged into this PC's COM port and read by this browser (Chrome or Edge); press Get and pick the port once.
      </p>
      {indicators.length > 0 && (
        <div className="mn-wb-devs">
          {indicators.map((d) => (
            <span key={String(d.id)} className="mn-wb-dev">
              <strong>{String(d.name)}</strong>
              <span className="mn-ord-meta"> · {String(d.connectionType)}{d.connectionType === 'simulated' && d.simulatedWeightKg != null ? ` · ${kg(d.simulatedWeightKg)} kg` : ''}</span>
              {d.isActive === false ? <Badge tone="neutral">inactive</Badge> : null}
            </span>
          ))}
        </div>
      )}
      <Form onSubmit={add} className="mn-wb-dev-form">
        <Field label="Name" required>
          <Input value={dev.name} onChange={(e) => setDev({ ...dev, name: e.target.value })} required placeholder="Gate weighbridge" />
        </Field>
        {plants.length > 1 && (
          <Field label="Plant">
            <Select value={dev.plantId} onChange={(e) => setDev({ ...dev, plantId: e.target.value })}>
              <option value="">Any plant</option>
              {plants.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Connection">
          <Select value={dev.connectionType} onChange={(e) => setDev({ ...dev, connectionType: e.target.value })}>
            <option value="simulated">Simulated</option>
            <option value="tcp">TCP</option>
            <option value="serial">Serial / COM</option>
          </Select>
        </Field>
        {dev.connectionType === 'simulated' && (
          <Field label="Demo weight (kg)">
            <Input type="number" step="any" inputMode="decimal" value={dev.simulatedWeightKg} onChange={(e) => setDev({ ...dev, simulatedWeightKg: e.target.value })} />
          </Field>
        )}
        {dev.connectionType === 'tcp' && (
          <>
            <Field label="Host"><Input value={dev.host} onChange={(e) => setDev({ ...dev, host: e.target.value })} placeholder="192.168.1.20" /></Field>
            <Field label="Port"><Input type="number" inputMode="numeric" value={dev.port} onChange={(e) => setDev({ ...dev, port: e.target.value })} placeholder="4001" /></Field>
          </>
        )}
        {dev.connectionType === 'serial' && (
          <>
            <Field label="COM port" help="A label for your records; the actual port is picked in the browser when you press Get."><Input value={dev.comPort} onChange={(e) => setDev({ ...dev, comPort: e.target.value })} placeholder="COM3" /></Field>
            <Field label="Baud" help="As set on the indicator; 9600 is the usual."><Input type="number" inputMode="numeric" value={dev.baudRate} onChange={(e) => setDev({ ...dev, baudRate: e.target.value })} /></Field>
          </>
        )}
        <div className="mn-wb-dev-submit">
          <Button type="submit" variant="secondary" icon={<Plus size={14} />} disabled={busy || !dev.name.trim()}>Add indicator</Button>
        </div>
      </Form>
    </Card>
  );
}
