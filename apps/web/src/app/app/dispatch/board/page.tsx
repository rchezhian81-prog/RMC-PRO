'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { batchTicketsApi, challansApi, crud, dispatchApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
// Happy-path board progression, plus the way out of each exception state so a
// delayed or returning load is never a dead-end (both are recoverable — only
// completed/cancelled/rejected are terminal on the server).
const NEXT: Record<string, { status: string; label: string }[]> = {
  loaded: [{ status: 'left_plant', label: 'Left plant' }],
  left_plant: [{ status: 'reached_site', label: 'Reached site' }],
  reached_site: [{ status: 'pouring', label: 'Start pour' }],
  pouring: [{ status: 'completed', label: 'Complete' }],
  delayed: [
    { status: 'reached_site', label: 'Reached site' },
    { status: 'completed', label: 'Complete' },
  ],
  returning: [{ status: 'completed', label: 'Complete' }],
};
// A load can be flagged delayed while it is still moving, and flagged as
// returning once it has left the plant with concrete on board.
const DELAYABLE = ['loaded', 'left_plant', 'reached_site', 'pouring'];
const RETURNABLE = ['left_plant', 'reached_site', 'pouring', 'delayed'];
const RETURN_REASONS = [
  { value: 'site_rejected', label: 'Rejected at site' },
  { value: 'excess_concrete', label: 'Excess / unpoured' },
  { value: 'access_issue', label: 'Site access issue' },
  { value: 'quality_issue', label: 'Quality issue' },
  { value: 'breakdown', label: 'Vehicle breakdown' },
  { value: 'other', label: 'Other' },
];

export default function DispatchBoardPage() {
  const router = useRouter();
  const { prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [drivers, setDrivers] = useState<Row[]>([]);
  const [challans, setChallans] = useState<Row[]>([]);
  // Which dispatch already has a challan → drives the button state below, so it
  // reflects the real relation rather than a status guess.
  const challanByDispatch = new Map(
    challans.filter((c) => c.dispatchId).map((c) => [String(c.dispatchId), c]),
  );
  const [form, setForm] = useState({ batchTicketId: '', vehicleId: '', driverId: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [d, b, v, dr, ch] = await Promise.all([
      dispatchApi.list(),
      batchTicketsApi.list('confirmed'),
      crud('vehicles').list(),
      crud('drivers').list(),
      challansApi.list(),
    ]);
    setRows(d);
    setBatches(b);
    setVehicles(v);
    setDrivers(dr);
    setChallans(ch);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await dispatchApi.createFromBatch(form.batchTicketId, {
        vehicleId: form.vehicleId || undefined,
        driverId: form.driverId || undefined,
      });
      setForm({ batchTicketId: '', vehicleId: '', driverId: '' });
    }, 'Dispatch created');
  }

  async function genChallan(d: Row) {
    await run(async () => {
      const ch = await challansApi.createFromDispatch(String(d.id), {});
      router.push(`/app/dispatch/challans/${ch.id}`);
    });
  }

  // Flag a load as delayed, capturing why so the board shows the hold-up
  // instead of a silent status flip.
  async function markDelayed(r: Row) {
    const reason = await prompt({
      title: `Mark ${String(r.dispatchNo)} delayed`,
      message: 'Records the hold-up on the board and in the delivery history.',
      label: 'Delay reason',
      placeholder: 'e.g. traffic, site not ready, plant hold',
      defaultValue: '',
    });
    if (reason === null) return;
    await run(() => dispatchApi.setStatus(String(r.id), 'delayed', { delayReason: reason || 'Delayed' }), 'Marked delayed');
  }

  // Concrete coming back to the plant (short pour / rejected load). Captures the
  // returned volume and reason on the trip; the priced wastage is booked later
  // when the challan is delivered.
  async function markReturning(r: Row) {
    const qtyStr = await prompt({
      title: `${String(r.dispatchNo)} returning`,
      message: 'Concrete coming back to the plant.',
      label: 'Returned quantity (m³)',
      type: 'number',
      defaultValue: '',
    });
    if (qtyStr === null) return;
    const reason = await prompt({
      title: `${String(r.dispatchNo)} returning`,
      label: 'Return reason',
      options: RETURN_REASONS,
    });
    if (reason === null) return;
    await run(
      () => dispatchApi.setStatus(String(r.id), 'returning', { returnQuantityM3: Number(qtyStr) || 0, returnReason: reason }),
      'Marked returning',
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Dispatch Board</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px', maxWidth: 760 }}>
        Create a dispatch from a confirmed batch ticket, move the load across the board, and generate the delivery challan.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="New dispatch">
          <Form onSubmit={create} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240 }}>
              <Field label="Confirmed batch" required>
                <select className="mn-input" value={form.batchTicketId} onChange={(e) => setForm({ ...form, batchTicketId: e.target.value })} required>
                  <option value="">— select —</option>
                  {batches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {String(b.batchTicketNo)} · {String(b.gradeLabel ?? '')} · {money(b.batchQuantityM3)} m³
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Vehicle">
                <select className="mn-input" value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                  <option value="">—</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={String(v.id)}>{String(v.vehicleNo)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Driver">
                <select className="mn-input" value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
                  <option value="">—</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={String(d.id)}>{String(d.driverName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create dispatch</Button>
            </div>
          </Form>
        </Card>
      </div>

      <Card title="Dispatches" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Dispatch No</Th>
                <Th>Grade</Th>
                <Th numeric>Qty m³</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = String(r.dispatchStatus);
                return (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600 }}>{String(r.dispatchNo ?? '')}</Td>
                    <Td>{String(r.gradeLabel ?? '—')}</Td>
                    <Td numeric>{money(r.quantityM3)}</Td>
                    <Td>
                      <StatusBadge status={st} />
                      {st === 'delayed' && r.delayReason ? (
                        <div style={{ fontSize: 11, color: 'var(--mn-muted)', marginTop: 2 }}>{String(r.delayReason)}</div>
                      ) : null}
                      {Number(r.returnQuantityM3) > 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--mn-muted)', marginTop: 2 }}>Return {money(r.returnQuantityM3)} m³</div>
                      ) : null}
                    </Td>
                    <Td>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(NEXT[st] ?? []).map((n) => (
                          <Button key={n.status} variant="secondary" size="sm" onClick={() => run(() => dispatchApi.setStatus(String(r.id), n.status), `Moved to ${n.status}`)}>
                            {n.label}
                          </Button>
                        ))}
                        {DELAYABLE.includes(st) && (
                          <Button variant="ghost" size="sm" onClick={() => markDelayed(r)}>Delay</Button>
                        )}
                        {RETURNABLE.includes(st) && (
                          <Button variant="ghost" size="sm" onClick={() => markReturning(r)}>Returning</Button>
                        )}
                        {challanByDispatch.has(String(r.id)) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/app/dispatch/challans/${challanByDispatch.get(String(r.id))!.id}`)}
                          >
                            View challan
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => genChallan(r)}>Generate challan</Button>
                        )}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No dispatches yet" description="Create a dispatch from a confirmed batch ticket above." />
        )}
      </Card>
    </div>
  );
}
