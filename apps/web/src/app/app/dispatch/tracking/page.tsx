'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatchApi, gpsApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const TRACKABLE = ['loaded', 'left_plant', 'reached_site', 'pouring', 'returning', 'delayed'];
const coord = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toFixed(5));
const ageLabel = (s: unknown) => {
  const sec = Number(s);
  if (!Number.isFinite(sec)) return '—';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
};

interface TrackSummary { pings: number; pathKm: number; straightLineKm: number }

export default function LiveTrackingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fleet, setFleet] = useState<Row[]>([]);
  const [dispatches, setDispatches] = useState<Row[]>([]);
  const [track, setTrack] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);

  // Manual ping form
  const [dispatchId, setDispatchId] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [speed, setSpeed] = useState('');

  const canRecord = getAccess().has('gps.record');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLive = useCallback(async () => {
    const [live, fl] = await Promise.all([gpsApi.live(), gpsApi.fleet().catch(() => [] as Row[])]);
    setRows(live);
    setFleet(fl);
  }, []);

  async function reloadAll() {
    const [live, disp, fl] = await Promise.all([gpsApi.live(), dispatchApi.list(), gpsApi.fleet().catch(() => [] as Row[])]);
    setRows(live);
    setFleet(fl);
    setDispatches((Array.isArray(disp) ? disp : []).filter((d) => TRACKABLE.includes(String(d.dispatchStatus))));
  }
  useEffect(() => {
    reloadAll().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Auto-refresh the live board.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(() => { loadLive().catch(() => {}); }, 15_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, loadLive]);

  async function recordPing() {
    setError(null); setMsg(null);
    if (!dispatchId) { setError('Select a dispatch to record against'); return; }
    if (lat === '' || lng === '') { setError('Enter a latitude and longitude'); return; }
    setBusy(true);
    try {
      await gpsApi.ping(dispatchId, { latitude: Number(lat), longitude: Number(lng), speedKmph: speed ? Number(speed) : undefined, source: 'manual' });
      setMsg('Location recorded.');
      setLat(''); setLng(''); setSpeed('');
      await reloadAll();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function showTrack(id: string) {
    setError(null);
    try { setTrack(await gpsApi.track(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  const summary = (track?.summary as TrackSummary | undefined) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Live Tracking</h1>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh (15s)
        </label>
        <Button variant="secondary" size="sm" onClick={() => loadLive().catch((e) => setError(String(e)))}>Refresh now</Button>
      </div>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Live position of every in-transit load, from the driver&apos;s phone (My Trips), a GPS vendor feed (Settings → GPS vendor feed) or a manual fix.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="On the road now" padded={false}>
          {rows.length ? (
            <Table>
              <thead>
                <tr><Th>Dispatch</Th><Th>Vehicle</Th><Th>Status</Th><Th>Last seen</Th><Th numeric>Speed</Th><Th>Location</Th><Th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)}>
                    <Td style={{ fontWeight: 600 }}>{String(r.dispatchNo)}</Td>
                    <Td>{String(r.vehicleNo ?? '—')}</Td>
                    <Td><StatusBadge status={String(r.dispatchStatus)} /></Td>
                    <Td>{ageLabel(r.ageSeconds)}</Td>
                    <Td numeric>{r.lastSpeedKmph != null ? `${Number(r.lastSpeedKmph).toFixed(0)} km/h` : '—'}</Td>
                    <Td>
                      <a href={`https://maps.google.com/?q=${coord(r.lastLatitude)},${coord(r.lastLongitude)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--mn-primary)' }}>
                        {coord(r.lastLatitude)}, {coord(r.lastLongitude)}
                      </a>
                    </Td>
                    <Td style={{ textAlign: 'right' }}><Button variant="secondary" size="sm" onClick={() => showTrack(String(r.id))}>Track</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No loads on the road" description="In-transit dispatches with a recent GPS fix appear here." />
          )}
        </Card>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Card title="Fleet — last known positions" padded={false}>
          {fleet.some((v) => v.lastLocationAt) ? (
            <Table>
              <thead>
                <tr><Th>Vehicle</Th><Th>Type</Th><Th>Driver</Th><Th>Trip</Th><Th>Last seen</Th><Th numeric>Speed</Th><Th>Location</Th></tr>
              </thead>
              <tbody>
                {fleet.filter((v) => v.lastLocationAt).map((v) => (
                  <tr key={String(v.id)}>
                    <Td style={{ fontWeight: 600 }}>{String(v.vehicleNo)}</Td>
                    <Td>{String(v.vehicleType ?? '—')}</Td>
                    <Td>{String(v.driverName ?? '—')}</Td>
                    <Td>{v.dispatchNo ? <>{String(v.dispatchNo)} <StatusBadge status={String(v.dispatchStatus)} /></> : <span style={{ color: 'var(--mn-muted)' }}>Idle</span>}</Td>
                    <Td>{ageLabel(v.ageSeconds)}</Td>
                    <Td numeric>{v.lastSpeedKmph != null ? `${Number(v.lastSpeedKmph).toFixed(0)} km/h` : '—'}</Td>
                    <Td>
                      <a href={`https://maps.google.com/?q=${coord(v.lastLatitude)},${coord(v.lastLongitude)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--mn-primary)' }}>
                        {coord(v.lastLatitude)}, {coord(v.lastLongitude)}
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No vehicle has reported a position yet" description="Positions arrive from the driver's phone, a GPS vendor feed, or a manual fix below." />
          )}
        </Card>
      </div>

      {track && summary && (
        <div style={{ marginBottom: 18 }}>
          <Card title={`Track — ${String(track.dispatchNo)}`}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
              <span><strong>{summary.pings}</strong> fixes</span>
              <span><strong>{summary.pathKm}</strong> km travelled</span>
              <span><strong>{summary.straightLineKm}</strong> km straight-line</span>
              <Button variant="ghost" size="sm" onClick={() => setTrack(null)}>Close</Button>
            </div>
          </Card>
        </div>
      )}

      {canRecord && (
        <Card title="Record a location (manual)">
          <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Dispatch">
                <select className="mn-input" value={dispatchId} onChange={(e) => setDispatchId(e.target.value)}>
                  <option value="">— select —</option>
                  {dispatches.map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.dispatchNo)} · {String(d.dispatchStatus)}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ width: 140 }}><Field label="Latitude"><Input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} /></Field></div>
            <div style={{ width: 140 }}><Field label="Longitude"><Input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} /></Field></div>
            <div style={{ width: 120 }}><Field label="Speed km/h"><Input type="number" step="any" value={speed} onChange={(e) => setSpeed(e.target.value)} /></Field></div>
            <Button onClick={recordPing} loading={busy}>Record</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
