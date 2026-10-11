'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { crud, ordersApi, pumpApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { StatusBadge } from '../../../../components/ui/Badge';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const dec = (v: unknown, dp = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: dp }));
const timeOf = (v: unknown) => { if (!v) return '—'; try { return new Date(String(v)).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }); } catch { return '—'; } };

const BASIS: { value: string; label: string }[] = [
  { value: 'per_m3', label: 'Per m³ pumped' },
  { value: 'per_hour', label: 'Per pump hour' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'included', label: 'Included in concrete rate' },
];
const BASIS_LABEL = Object.fromEntries(BASIS.map((b) => [b.value, b.label]));

const NEXT: Record<string, { status: string; label: string }[]> = {
  planned: [{ status: 'on_site', label: 'Pump on site' }, { status: 'pumping', label: 'Start pumping' }],
  on_site: [{ status: 'pumping', label: 'Start pumping' }],
  pumping: [{ status: 'completed', label: 'Finish' }],
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default function PumpsPage() {
  const { prompt, confirm } = useConfirm();
  const [pumps, setPumps] = useState<Row[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [drivers, setDrivers] = useState<Row[]>([]);
  const [report, setReport] = useState<{ range: { from: string; to: string }; perPump: Row[]; reconciliation: { rows: Row[]; totals: Record<string, number> } } | null>(null);
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(ymd(new Date()));
  const [filterStatus, setFilterStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const EMPTY_FORM = { pumpVehicleId: '', orderId: '', operatorDriverId: '', scheduledDate: ymd(new Date()), scheduledTime: '', pipelineLengthM: '', chargeBasis: 'per_m3', rate: '', remarks: '' };
  const [form, setForm] = useState(EMPTY_FORM);
  // The planned job loaded into the form, or null when the form plans a new one.
  const [editing, setEditing] = useState<{ id: string; jobNo: string } | null>(null);
  const formCard = useRef<HTMLDivElement>(null);
  const canManage = getAccess().has('pump.manage');

  async function reload() {
    const [p, j, o, d, r] = await Promise.all([
      pumpApi.pumps(),
      pumpApi.list({ status: filterStatus || undefined, limit: 200 }),
      // Only confirmed orders can have a pump booked; the picker puts the ones
      // that asked for a pump first, then the newest.
      ordersApi.list('confirmed', 200).catch(() => [] as Row[]),
      crud('drivers').list({ active: true }).catch(() => [] as Row[]),
      pumpApi.utilisation(from, to).catch(() => null),
    ]);
    setPumps(p); setJobs(j); setDrivers(d); setReport(r);
    setOrders([...o].sort((a, b) => Number(Boolean(b.pumpRequired)) - Number(Boolean(a.pumpRequired))));
  }

  /** `Customer · Site · Order no` — the customer first, as the yard asks for it. */
  const orderLabel = (o: Row) => [String(o.customerName ?? 'Customer not set'), o.siteName ? String(o.siteName) : '', String(o.orderNo ?? '')].filter(Boolean).join(' · ') + (o.pumpRequired ? ' · pump required' : '');

  function startEdit(j: Row) {
    setEditing({ id: String(j.id), jobNo: String(j.jobNo) });
    setForm({
      pumpVehicleId: String(j.pumpVehicleId ?? ''),
      orderId: String(j.orderId ?? ''),
      operatorDriverId: String(j.operatorDriverId ?? ''),
      scheduledDate: String(j.scheduledDate ?? '').slice(0, 10),
      scheduledTime: String(j.scheduledTime ?? ''),
      pipelineLengthM: j.pipelineLengthM == null ? '' : String(j.pipelineLengthM),
      chargeBasis: String(j.chargeBasis ?? 'per_m3'),
      rate: j.rate == null ? '' : String(j.rate),
      remarks: String(j.remarks ?? ''),
    });
    setError(null); setMsg(null);
    formCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  /** The body for plan and for save alike — a blank means "clear it" on save. */
  const body = () => ({
    pumpVehicleId: form.pumpVehicleId, orderId: form.orderId || null, operatorDriverId: form.operatorDriverId || null,
    scheduledDate: form.scheduledDate || null, scheduledTime: form.scheduledTime || null,
    pipelineLengthM: form.pipelineLengthM ? Number(form.pipelineLengthM) : null,
    chargeBasis: form.chargeBasis, rate: form.rate ? Number(form.rate) : 0, remarks: form.remarks || null,
  });

  async function save() {
    if (!editing) return;
    if (!form.pumpVehicleId) { setError('Choose the pump'); return; }
    const { id, jobNo } = editing;
    await run(async () => {
      await pumpApi.update(id, body());
      setEditing(null);
      setForm(EMPTY_FORM);
    }, `Pump job ${jobNo} updated.`);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoaded(true));
  }, [filterStatus, from, to]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null); setBusy(true);
    try { await fn(); await reload(); if (okMsg) setMsg(okMsg); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!form.pumpVehicleId) { setError('Choose the pump'); return; }
    await run(async () => {
      const j = await pumpApi.create({
        pumpVehicleId: form.pumpVehicleId, orderId: form.orderId || undefined, operatorDriverId: form.operatorDriverId || undefined,
        scheduledDate: form.scheduledDate || undefined, scheduledTime: form.scheduledTime || undefined,
        pipelineLengthM: form.pipelineLengthM ? Number(form.pipelineLengthM) : undefined,
        chargeBasis: form.chargeBasis, rate: form.rate ? Number(form.rate) : 0, remarks: form.remarks || undefined,
      });
      setMsg(`Pump job ${String(j.jobNo)} planned for ${String(j.pumpVehicleNo)}${j.siteName ? ` at ${String(j.siteName)}` : ''}.`);
      setForm((f) => ({ ...f, orderId: '', scheduledTime: '', pipelineLengthM: '', rate: '', remarks: '' }));
    });
  }

  async function advance(j: Row, status: string) {
    if (status === 'completed') {
      const q = await prompt({ title: `Finish ${String(j.jobNo)}`, message: 'How much concrete went through the pump? Pump hours are worked out from the start time; enter them if the clock is wrong.', label: 'Pumped m³', defaultValue: '' });
      if (q === null) return;
      const h = await prompt({ title: `Pump hours for ${String(j.jobNo)}`, message: 'Leave blank to use the time between start and now.', label: 'Pump hours', defaultValue: '' });
      if (h === null) return;
      const extra: Record<string, unknown> = {};
      if (q.trim() !== '') extra.pumpedQuantityM3 = Number(q);
      if (h.trim() !== '') extra.pumpHours = Number(h);
      await run(() => pumpApi.setStatus(String(j.id), 'completed', extra), `${String(j.jobNo)} completed.`);
      return;
    }
    await run(() => pumpApi.setStatus(String(j.id), status), `${String(j.jobNo)}: ${status.replace('_', ' ')}.`);
  }

  async function cancel(j: Row) {
    if (!(await confirm({ title: `Cancel pump job ${String(j.jobNo)}?`, message: 'The pump is freed and the job is kept as cancelled.', confirmLabel: 'Cancel job' }))) return;
    await run(() => pumpApi.setStatus(String(j.id), 'cancelled'), `${String(j.jobNo)} cancelled.`);
  }

  const t = report?.reconciliation.totals ?? {};
  // While editing, the job's order may have moved past 'confirmed' and so be
  // missing from the picker; keep it selectable under its own label.
  const currentJob = editing && form.orderId && !orders.some((o) => String(o.id) === form.orderId) ? jobs.find((j) => String(j.id) === editing.id) : undefined;
  const currentOrder = currentJob ? [String(currentJob.customerName ?? ''), currentJob.siteName ? String(currentJob.siteName) : '', String(currentJob.orderNo ?? '')].filter(Boolean).join(' · ') || 'Current order' : null;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Pumps</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>
        The pump register, pump jobs (booked → on site → pumping → done, with hours and pumped m³) and the pump-charge reconciliation against what each order bills.
        A pump is any vehicle whose type is &quot;Concrete pump&quot; under Masters → Vehicles.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="Pump register" padded={false}>
          {!loaded ? <TableSkeleton cols={6} /> : pumps.length ? (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead><tr><Th>Pump</Th><Th>Type</Th><Th>Operator</Th><Th>Now</Th><Th numeric>Open jobs</Th><Th numeric>Hours this month</Th><Th numeric>m³ this month</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {pumps.map((p) => (
                    <tr key={String(p.id)}>
                      <Td style={{ fontWeight: 600 }}>{String(p.vehicleNo)}</Td>
                      <Td>{String(p.vehicleType ?? '')}</Td>
                      <Td>{String(p.operatorName ?? '—')}</Td>
                      <Td>{p.currentJobNo ? `${String(p.currentJobNo)} · ${String(p.currentJobStatus).replace('_', ' ')}${p.currentSiteName ? ` at ${String(p.currentSiteName)}` : ''}` : 'Free'}</Td>
                      <Td numeric>{dec(p.openJobs, 0)}</Td>
                      <Td numeric>{dec(p.hoursThisMonth)}</Td>
                      <Td numeric>{dec(p.m3ThisMonth, 3)}</Td>
                      <Td><StatusBadge status={String(p.status ?? '')} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No pumps in the vehicle master" description='Add the pump under Masters → Vehicles with type "Concrete pump".' />
          )}
        </Card>
      </div>

      {canManage && (
        <div style={{ marginBottom: 18 }} ref={formCard} className={editing ? 'mn-pj-editing' : undefined}>
          <Card title={editing ? `Edit job ${editing.jobNo}` : 'Plan a pump job'}>
            <div className="mn-pj-form">
              <div style={{ minWidth: 170 }}>
                <Field label="Pump" required>
                  <select className="mn-input" value={form.pumpVehicleId} onChange={(e) => setForm({ ...form, pumpVehicleId: e.target.value })}>
                    <option value="">— select —</option>
                    {pumps.filter((p) => String(p.status) !== 'inactive' || String(p.id) === form.pumpVehicleId).map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.vehicleNo)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 260 }}>
                <Field label="Order (customer · site · order no)">
                  <select className="mn-input" value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}>
                    <option value="">— none —</option>
                    {orders.map((o) => (
                      <option key={String(o.id)} value={String(o.id)}>{orderLabel(o)}</option>
                    ))}
                    {/* The job's own order when it is no longer confirmed (delivered, closed), so editing does not silently drop it. */}
                    {currentOrder && <option value={form.orderId}>{currentOrder}</option>}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 170 }}>
                <Field label="Operator">
                  <select className="mn-input" value={form.operatorDriverId} onChange={(e) => setForm({ ...form, operatorDriverId: e.target.value })}>
                    <option value="">— none —</option>
                    {drivers.map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.driverName)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ width: 150 }}><Field label="Date"><Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} /></Field></div>
              <div style={{ width: 110 }}><Field label="Time"><Input type="time" value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} /></Field></div>
              <div style={{ width: 120 }}><Field label="Pipeline m"><Input type="number" step="any" value={form.pipelineLengthM} onChange={(e) => setForm({ ...form, pipelineLengthM: e.target.value })} /></Field></div>
              <div style={{ minWidth: 190 }}>
                <Field label="Charge basis">
                  <select className="mn-input" value={form.chargeBasis} onChange={(e) => setForm({ ...form, chargeBasis: e.target.value })}>
                    {BASIS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ width: 120 }}><Field label="Rate ₹"><Input type="number" step="any" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} disabled={form.chargeBasis === 'included'} /></Field></div>
              <div style={{ minWidth: 200 }}><Field label="Remarks"><Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field></div>
              <div className="mn-pj-form-acts">
                {editing ? (
                  <>
                    <Button onClick={save} loading={busy}>Save changes</Button>
                    <Button variant="ghost" onClick={cancelEdit} disabled={busy}>Cancel</Button>
                  </>
                ) : (
                  <Button onClick={create} loading={busy}>Plan job</Button>
                )}
              </div>
            </div>
            {editing && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--mn-muted)' }}>The plan can be changed until pumping starts. The charge is worked out again from the basis and the rate.</p>}
          </Card>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="Pump jobs" padded={false}
          actions={
            <select className="mn-input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              {['planned', 'on_site', 'pumping', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          }
        >
          {!loaded ? <TableSkeleton cols={8} /> : jobs.length ? (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead><tr><Th>Job</Th><Th>Date</Th><Th>Pump</Th><Th>Order / site</Th><Th>Operator</Th><Th>Status</Th><Th>On site</Th><Th>Pumping</Th><Th numeric>Pumped m³</Th><Th numeric>Hours</Th><Th>Basis</Th><Th numeric>Charge ₹</Th><Th /></tr></thead>
                <tbody>
                  {jobs.map((j) => {
                    const st = String(j.status);
                    return (
                      <tr key={String(j.id)}>
                        <Td style={{ fontWeight: 600 }}>{String(j.jobNo)}</Td>
                        <Td>{formatDate(j.scheduledDate)}{j.scheduledTime ? ` ${String(j.scheduledTime)}` : ''}</Td>
                        <Td>{String(j.pumpVehicleNo ?? '')}</Td>
                        <Td>{j.orderNo ? `${String(j.orderNo)} · ` : ''}{String(j.customerName ?? '')}{j.siteName ? ` · ${String(j.siteName)}` : ''}</Td>
                        <Td>{String(j.operatorName ?? '—')}</Td>
                        <Td><StatusBadge status={st} /></Td>
                        <Td>{timeOf(j.arrivedAt)}</Td>
                        <Td>{j.pumpingStartAt ? `${timeOf(j.pumpingStartAt)}${j.pumpingEndAt ? ` → ${timeOf(j.pumpingEndAt)}` : ''}` : '—'}</Td>
                        <Td numeric>{dec(j.pumpedQuantityM3, 3)}</Td>
                        <Td numeric>{dec(j.pumpHours)}</Td>
                        <Td>{BASIS_LABEL[String(j.chargeBasis)] ?? String(j.chargeBasis)}{Number(j.rate) ? ` @ ₹${money(j.rate)}` : ''}</Td>
                        <Td numeric>₹{money(j.chargeAmount)}</Td>
                        <Td style={{ whiteSpace: 'nowrap' }}>
                          {canManage && (NEXT[st] ?? []).map((n) => (
                            <Button key={n.status} size="sm" variant={n.status === 'completed' ? 'primary' : 'secondary'} onClick={() => advance(j, n.status)} disabled={busy} style={{ marginRight: 6 }}>{n.label}</Button>
                          ))}
                          {canManage && ['planned', 'on_site'].includes(st) && <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => startEdit(j)} disabled={busy} style={{ marginRight: 6 }}>Edit</Button>}
                          {canManage && ['planned', 'on_site'].includes(st) && <Button size="sm" variant="ghost" onClick={() => cancel(j)} disabled={busy}>Cancel</Button>}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No pump jobs" description={canManage ? 'Plan the first pump job above.' : 'Nothing to show.'} />
          )}
        </Card>
      </div>

      <Card title="Utilisation & pump-charge reconciliation"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            <span style={{ fontSize: 12, color: 'var(--mn-muted)' }}>to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </div>
        }
      >
        {report ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead><tr><Th>Pump</Th><Th numeric>Jobs done</Th><Th numeric>Open</Th><Th numeric>Cancelled</Th><Th numeric>Pump hours</Th><Th numeric>Waiting hours</Th><Th numeric>Pumped m³</Th><Th numeric>Charged ₹</Th></tr></thead>
                <tbody>
                  {report.perPump.map((p) => (
                    <tr key={String(p.vehicleId)}>
                      <Td style={{ fontWeight: 600 }}>{String(p.vehicleNo)}</Td>
                      <Td numeric>{dec(p.jobsCompleted, 0)}</Td><Td numeric>{dec(p.jobsOpen, 0)}</Td><Td numeric>{dec(p.jobsCancelled, 0)}</Td>
                      <Td numeric>{dec(p.pumpHours)}</Td><Td numeric>{dec(p.waitingHours)}</Td><Td numeric>{dec(p.pumpedM3, 3)}</Td><Td numeric>₹{money(p.chargeAmount)}</Td>
                    </tr>
                  ))}
                  {!report.perPump.length && <tr><Td colSpan={8}>No pumps.</Td></tr>}
                </tbody>
              </Table>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
              <span><strong>{dec(t.orders, 0)}</strong> orders with pumping</span>
              <span><strong>{dec(t.pumpedM3, 3)}</strong> m³ pumped</span>
              <span><strong>{dec(t.pumpHours)}</strong> pump hours</span>
              <span><strong>₹{money(t.jobChargeAmount)}</strong> job charges</span>
              <span><strong>₹{money(t.billedPumpCharge)}</strong> billed on orders</span>
              <span style={{ color: (t.flagged ?? 0) > 0 ? 'var(--mn-warning)' : 'var(--mn-success)' }}><strong>{dec(t.flagged, 0)}</strong> flagged</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead><tr><Th>Order</Th><Th>Customer</Th><Th>Pump required</Th><Th numeric>Pump ₹/m³ on order</Th><Th numeric>Delivered m³</Th><Th numeric>Pumped m³</Th><Th numeric>Hours</Th><Th numeric>Job charges ₹</Th><Th numeric>Billed ₹</Th><Th>Findings</Th></tr></thead>
                <tbody>
                  {report.reconciliation.rows.map((r) => (
                    <tr key={String(r.orderId)}>
                      <Td style={{ fontWeight: 600 }}>{String(r.orderNo)}</Td>
                      <Td>{String(r.customerName ?? '')}</Td>
                      <Td>{r.pumpRequired ? 'Yes' : 'No'}</Td>
                      <Td numeric>₹{money(r.pumpChargePerM3)}</Td>
                      <Td numeric>{dec(r.deliveredM3, 3)}</Td>
                      <Td numeric>{dec(r.pumpedM3, 3)}</Td>
                      <Td numeric>{dec(r.pumpHours)}</Td>
                      <Td numeric>₹{money(r.jobChargeAmount)}</Td>
                      <Td numeric>₹{money(r.billedPumpCharge)}</Td>
                      <Td style={{ color: (r.flags as string[]).length ? 'var(--mn-warning)' : 'var(--mn-success)', fontSize: 12.5 }}>{(r.flags as string[]).length ? (r.flags as string[]).join('; ') : 'OK'}</Td>
                    </tr>
                  ))}
                  {!report.reconciliation.rows.length && <tr><Td colSpan={10}>No orders with pumping in this range.</Td></tr>}
                </tbody>
              </Table>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--mn-muted)' }}>{loaded ? 'The report could not be loaded.' : 'Loading…'}</p>
        )}
      </Card>
    </div>
  );
}
