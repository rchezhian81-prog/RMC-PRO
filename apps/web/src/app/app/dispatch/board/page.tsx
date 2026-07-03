'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { batchTicketsApi, challansApi, crud, dispatchApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const NEXT: Record<string, { status: string; label: string }[]> = {
  loaded: [{ status: 'left_plant', label: 'Left plant' }],
  left_plant: [{ status: 'reached_site', label: 'Reached site' }],
  reached_site: [{ status: 'pouring', label: 'Start pour' }],
  pouring: [{ status: 'completed', label: 'Complete' }],
};
const statusColor: Record<string, string> = {
  loaded: '#8ab4ff', left_plant: '#e0b341', reached_site: '#e0b341', pouring: '#e0b341',
  completed: '#6ee7a8', cancelled: '#ff8080', rejected: '#ff8080',
};

export default function DispatchBoardPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [drivers, setDrivers] = useState<Row[]>([]);
  const [form, setForm] = useState({ batchTicketId: '', vehicleId: '', driverId: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [d, b, v, dr] = await Promise.all([dispatchApi.list(), batchTicketsApi.list('confirmed'), crud('vehicles').list(), crud('drivers').list()]);
    setRows(d);
    setBatches(b);
    setVehicles(v);
    setDrivers(dr);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); await reload(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await dispatchApi.createFromBatch(form.batchTicketId, { vehicleId: form.vehicleId || undefined, driverId: form.driverId || undefined });
      setForm({ batchTicketId: '', vehicleId: '', driverId: '' });
    }, 'Dispatch created');
  }

  async function genChallan(d: Row) {
    await run(async () => {
      const ch = await challansApi.createFromDispatch(String(d.id), {});
      router.push(`/app/dispatch/challans/${ch.id}`);
    });
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Dispatch Board</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Create a dispatch from a confirmed batch ticket, move the load across the board, and generate the delivery challan.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New dispatch</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Confirmed batch</label>
            <select style={{ ...input, width: 220 }} value={form.batchTicketId} onChange={(e) => setForm({ ...form, batchTicketId: e.target.value })} required>
              <option value="">— select —</option>
              {batches.map((b) => <option key={b.id} value={String(b.id)}>{String(b.batchTicketNo)} · {String(b.gradeLabel ?? '')} · {money(b.batchQuantityM3)} m³</option>)}
            </select>
          </div>
          <div><label style={lbl}>Vehicle</label>
            <select style={{ ...input, width: 140 }} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
              <option value="">—</option>
              {vehicles.map((v) => <option key={v.id} value={String(v.id)}>{String(v.vehicleNo)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Driver</label>
            <select style={{ ...input, width: 140 }} value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
              <option value="">—</option>
              {drivers.map((d) => <option key={d.id} value={String(d.id)}>{String(d.driverName)}</option>)}
            </select>
          </div>
          <button style={button}>Create dispatch</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Dispatch No</th><th style={th}>Grade</th><th style={th}>Qty m³</th><th style={th}>Status</th><th style={th}>Actions</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const st = String(r.dispatchStatus);
              return (
                <tr key={r.id}>
                  <td style={td}>{String(r.dispatchNo ?? '')}</td>
                  <td style={td}>{String(r.gradeLabel ?? '—')}</td>
                  <td style={td}>{money(r.quantityM3)}</td>
                  <td style={td}><span style={{ color: statusColor[st] ?? 'var(--text)', fontWeight: 600 }}>{st}</span></td>
                  <td style={td}>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(NEXT[st] ?? []).map((n) => (
                        <button key={n.status} style={ghostButton} onClick={() => run(() => dispatchApi.setStatus(String(r.id), n.status), `Moved to ${n.status}`)}>{n.label}</button>
                      ))}
                      <button style={button} onClick={() => genChallan(r)}>Generate challan</button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td style={td} colSpan={5}>No dispatches yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const lbl = { fontSize: 12, color: 'var(--muted)' } as const;
