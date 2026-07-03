'use client';

import { useCallback, useEffect, useState } from 'react';
import { syncApi, type Row } from '../../../lib/api';
import { button, card, ghostButton, table, td, th } from '../../../lib/ui';

const dt = (v: unknown) => (v ? String(v).slice(0, 19).replace('T', ' ') : '—');

export default function DevicesSyncPage() {
  const [devices, setDevices] = useState<Row[]>([]);
  const [reservations, setReservations] = useState<Row[]>([]);
  const [conflicts, setConflicts] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [d, r, c] = await Promise.all([syncApi.devices(), syncApi.reservations(), syncApi.conflicts()]);
    setDevices(d); setReservations(r); setConflicts(c);
  }, []);
  useEffect(() => { reload().catch((e) => setError(String(e))); }, [reload]);

  async function resolve(id: string, resolution: string) {
    setError(null); setMsg(null);
    try { await syncApi.resolveConflict(id, resolution); setMsg(`Conflict resolved (${resolution}).`); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Devices &amp; Sync</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Registered plant devices, cloud-issued number reservations, and offline↔cloud conflicts.</p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Devices</h3>
        <table style={table}>
          <thead><tr><th style={th}>Name</th><th style={th}>Type</th><th style={th}>Identifier</th><th style={th}>Status</th><th style={th}>Last sync</th></tr></thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td style={td}>{String(d.deviceName ?? '')}</td>
                <td style={td}>{String(d.deviceType ?? '')}</td>
                <td style={td}>{String(d.deviceIdentifier ?? '')}</td>
                <td style={td}>{String(d.status ?? '')}</td>
                <td style={td}>{dt(d.lastSyncToken)}</td>
              </tr>
            ))}
            {!devices.length && <tr><td style={td} colSpan={5}>No devices registered.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Number reservations</h3>
        <table style={table}>
          <thead><tr><th style={th}>Document</th><th style={th}>Prefix</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Used</th><th style={th}>Status</th></tr></thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.documentType ?? '')}</td>
                <td style={td}>{String(r.prefix ?? '')}</td>
                <td style={td}>{String(r.numberFrom)}</td>
                <td style={td}>{String(r.numberTo)}</td>
                <td style={td}>{String(r.usedCount)}</td>
                <td style={td}>{String(r.status)}</td>
              </tr>
            ))}
            {!reservations.length && <tr><td style={td} colSpan={6}>No reservations.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Sync conflicts</h3>
        <table style={table}>
          <thead><tr><th style={th}>Entity</th><th style={th}>Reason</th><th style={th}>Cloud ID</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={c.id}>
                <td style={td}>{String(c.entityName ?? '')}</td>
                <td style={td}>{String(c.conflictReason ?? '')}</td>
                <td style={td}><code style={{ fontSize: 11 }}>{String(c.cloudId ?? '—').slice(0, 8)}</code></td>
                <td style={td}>{String(c.resolutionStatus)}</td>
                <td style={td}>
                  {c.resolutionStatus === 'pending' && (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button style={button} onClick={() => resolve(String(c.id), 'keep_cloud')}>Keep cloud</button>
                      <button style={ghostButton} onClick={() => resolve(String(c.id), 'keep_local')}>Keep local</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!conflicts.length && <tr><td style={td} colSpan={5}>No conflicts.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
