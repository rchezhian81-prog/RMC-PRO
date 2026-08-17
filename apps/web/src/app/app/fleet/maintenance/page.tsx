'use client';

import { useEffect, useState } from 'react';
import { crud, fleetApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const JOB_TYPES = ['service', 'repair', 'breakdown'];

export default function FleetMaintenancePage() {
  const { confirm } = useConfirm();
  const [schedules, setSchedules] = useState<Row[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Schedule form
  const [sVehicle, setSVehicle] = useState('');
  const [sType, setSType] = useState('');
  const [sIntervalKm, setSIntervalKm] = useState('');
  const [sIntervalDays, setSIntervalDays] = useState('');
  const [sLastOdo, setSLastOdo] = useState('');
  const [sLastDate, setSLastDate] = useState('');

  // Job form
  const [jVehicle, setJVehicle] = useState('');
  const [jType, setJType] = useState('service');
  const [jSchedule, setJSchedule] = useState('');
  const [jOdo, setJOdo] = useState('');
  const [jVendor, setJVendor] = useState('');
  const [jLabour, setJLabour] = useState('');
  const [jParts, setJParts] = useState('');
  const [jDowntime, setJDowntime] = useState('');
  const [jDesc, setJDesc] = useState('');

  const canRecord = getAccess().has('fleet.maintenance.record');
  const vehLabel = (id: unknown) => String(vehicles.find((v) => String(v.id) === String(id))?.vehicleNo ?? '—');

  async function reload() {
    const [sc, jb, vh] = await Promise.all([fleetApi.schedules(), fleetApi.jobs(), crud('vehicles').list()]);
    setSchedules(sc); setJobs(jb); setVehicles(vh);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoaded(true));
  }, []);

  async function createSchedule() {
    setError(null); setMsg(null);
    if (!sVehicle) { setError('Select a vehicle for the schedule'); return; }
    if (!sType.trim()) { setError('Enter a service type'); return; }
    if (!sIntervalKm && !sIntervalDays) { setError('Set an interval in km and/or days'); return; }
    setBusy(true);
    try {
      const s = await fleetApi.createSchedule({
        vehicleId: sVehicle, serviceType: sType.trim(),
        intervalKm: sIntervalKm ? Number(sIntervalKm) : undefined,
        intervalDays: sIntervalDays ? Number(sIntervalDays) : undefined,
        lastServiceOdometer: sLastOdo ? Number(sLastOdo) : undefined,
        lastServiceDate: sLastDate || undefined,
      });
      setMsg(`Service schedule for ${vehLabel(s.vehicleId)} — ${String(s.serviceType)} created.`);
      setSType(''); setSIntervalKm(''); setSIntervalDays(''); setSLastOdo(''); setSLastDate('');
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function createJob() {
    setError(null); setMsg(null);
    if (!jVehicle) { setError('Select a vehicle for the job'); return; }
    setBusy(true);
    try {
      const j = await fleetApi.createJob({
        vehicleId: jVehicle, jobType: jType, scheduleId: jSchedule || undefined,
        odometer: jOdo ? Number(jOdo) : undefined, vendorName: jVendor || undefined,
        labourCost: jLabour ? Number(jLabour) : undefined, partsCost: jParts ? Number(jParts) : undefined,
        downtimeHours: jDowntime ? Number(jDowntime) : undefined, description: jDesc || undefined,
      });
      setMsg(`${jType} job ${String(j.jobNo)} logged for ${vehLabel(j.vehicleId)}.`);
      setJOdo(''); setJVendor(''); setJLabour(''); setJParts(''); setJDowntime(''); setJDesc(''); setJSchedule('');
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null); setMsg(null);
    try { await fn(); await reload(); setMsg(okMsg); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function completeJob(j: Row) {
    if (!(await confirm({ title: 'Complete job', message: `Mark ${String(j.jobNo)} complete? A linked service schedule will roll forward.`, confirmLabel: 'Complete' }))) return;
    await act(() => fleetApi.completeJob(String(j.id), {}), `Job ${String(j.jobNo)} completed.`);
  }

  const schedulesForVehicle = jVehicle ? schedules.filter((s) => String(s.vehicleId) === jVehicle && s.isActive) : [];

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Fleet Maintenance</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Preventive service schedules and the maintenance / breakdown log for mixers and pumps.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canRecord && (
        <div style={{ marginBottom: 18 }}>
          <Card title="New service schedule">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 180 }}>
                <Field label="Vehicle" required>
                  <select className="mn-input" value={sVehicle} onChange={(e) => setSVehicle(e.target.value)}>
                    <option value="">— select —</option>
                    {vehicles.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 160 }}><Field label="Service type" required><Input value={sType} placeholder="engine_oil" onChange={(e) => setSType(e.target.value)} /></Field></div>
              <div style={{ width: 120 }}><Field label="Every (km)"><Input type="number" step="any" value={sIntervalKm} onChange={(e) => setSIntervalKm(e.target.value)} /></Field></div>
              <div style={{ width: 120 }}><Field label="Every (days)"><Input type="number" step="any" value={sIntervalDays} onChange={(e) => setSIntervalDays(e.target.value)} /></Field></div>
              <div style={{ width: 140 }}><Field label="Last service odo"><Input type="number" step="any" value={sLastOdo} onChange={(e) => setSLastOdo(e.target.value)} /></Field></div>
              <div style={{ width: 150 }}><Field label="Last service date"><Input type="date" value={sLastDate} onChange={(e) => setSLastDate(e.target.value)} /></Field></div>
              <Button onClick={createSchedule} loading={busy}>Add schedule</Button>
            </div>
          </Card>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="Service schedules" padded={false}>
          {!loaded ? (
            <TableSkeleton cols={5} />
          ) : schedules.length ? (
            <Table>
              <thead>
                <tr><Th>Vehicle</Th><Th>Service</Th><Th numeric>Every</Th><Th numeric>Next due</Th><Th>Status</Th></tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const due = (s.dueState ?? {}) as { status?: string };
                  const every = [s.intervalKm ? `${money(s.intervalKm)} km` : null, s.intervalDays ? `${String(s.intervalDays)} d` : null].filter(Boolean).join(' / ');
                  const nextDue = [s.nextDueOdometer ? `${money(s.nextDueOdometer)} km` : null, s.nextDueDate ? String(s.nextDueDate) : null].filter(Boolean).join(' · ') || '—';
                  return (
                    <tr key={String(s.id)}>
                      <Td style={{ fontWeight: 600 }}>{vehLabel(s.vehicleId)}</Td>
                      <Td>{String(s.serviceType)}</Td>
                      <Td numeric>{every || '—'}</Td>
                      <Td numeric>{nextDue}</Td>
                      <Td><StatusBadge status={String(due.status ?? 'ok')} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No service schedules yet" description={canRecord ? 'Add a preventive schedule above.' : 'Nothing to show.'} />
          )}
        </Card>
      </div>

      {canRecord && (
        <div style={{ marginBottom: 18 }}>
          <Card title="Log a maintenance / breakdown job">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 170 }}>
                <Field label="Vehicle" required>
                  <select className="mn-input" value={jVehicle} onChange={(e) => { setJVehicle(e.target.value); setJSchedule(''); }}>
                    <option value="">— select —</option>
                    {vehicles.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ width: 140 }}>
                <Field label="Type">
                  <select className="mn-input" value={jType} onChange={(e) => setJType(e.target.value)}>
                    {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 170 }}>
                <Field label="Fulfils schedule">
                  <select className="mn-input" value={jSchedule} onChange={(e) => setJSchedule(e.target.value)} disabled={!schedulesForVehicle.length}>
                    <option value="">— none —</option>
                    {schedulesForVehicle.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.serviceType)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ width: 120 }}><Field label="Odometer"><Input type="number" step="any" value={jOdo} onChange={(e) => setJOdo(e.target.value)} /></Field></div>
              <div style={{ minWidth: 150 }}><Field label="Garage / vendor"><Input value={jVendor} onChange={(e) => setJVendor(e.target.value)} /></Field></div>
              <div style={{ width: 110 }}><Field label="Labour ₹"><Input type="number" step="any" value={jLabour} onChange={(e) => setJLabour(e.target.value)} /></Field></div>
              <div style={{ width: 110 }}><Field label="Parts ₹"><Input type="number" step="any" value={jParts} onChange={(e) => setJParts(e.target.value)} /></Field></div>
              <div style={{ width: 110 }}><Field label="Downtime hrs"><Input type="number" step="any" value={jDowntime} onChange={(e) => setJDowntime(e.target.value)} /></Field></div>
              <div style={{ minWidth: 180, flex: 1 }}><Field label="Description"><Input value={jDesc} onChange={(e) => setJDesc(e.target.value)} /></Field></div>
              <Button onClick={createJob} loading={busy}>Log job</Button>
            </div>
          </Card>
        </div>
      )}

      <Card title="Maintenance jobs" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : jobs.length ? (
          <Table>
            <thead>
              <tr><Th>Job No</Th><Th>Vehicle</Th><Th>Type</Th><Th>Reported</Th><Th numeric>Cost</Th><Th>Status</Th><Th /></tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const status = String(j.status);
                return (
                  <tr key={String(j.id)}>
                    <Td style={{ fontWeight: 600 }}>{String(j.jobNo)}</Td>
                    <Td>{vehLabel(j.vehicleId)}</Td>
                    <Td>{String(j.jobType)}</Td>
                    <Td>{String(j.reportedDate ?? '—')}</Td>
                    <Td numeric>₹{money(j.totalCost)}</Td>
                    <Td><StatusBadge status={status} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canRecord && status === 'open' && (
                          <Button variant="secondary" size="sm" onClick={() => completeJob(j)}>Complete</Button>
                        )}
                        {canRecord && status === 'open' && (
                          <Button variant="ghost" size="sm" onClick={() => act(() => fleetApi.cancelJob(String(j.id)), `Job ${String(j.jobNo)} cancelled.`)}>Cancel</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No maintenance jobs yet" description={canRecord ? 'Log a service or breakdown above.' : 'Nothing to show.'} />
        )}
      </Card>
    </div>
  );
}
