'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, ExternalLink, MapPin, Navigation, Plus, RefreshCw, Route, Truck, X } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { dispatchApi, gpsApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Live tracking — where every load on the road is right now.
 *
 * A pill counts the loads with a recent fix and the auto-refresh switch
 * sits beside it; a status strip with live counts doubles as the filter;
 * each load is one row: dispatch and grade, the truck, the status, when it
 * was last seen and how fast, the position as a map link, and Track, which
 * opens the trip's path summary. The manual fix form opens on demand for a
 * driver phoning in. Same layout in both skins; every colour reads the
 * semantic tokens.
 */

const TRACKABLE = ['loaded', 'left_plant', 'reached_site', 'pouring', 'returning', 'delayed'];
const coord = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toFixed(5));
const ageLabel = (s: unknown) => {
  const sec = Number(s);
  if (!Number.isFinite(sec)) return 'never';
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  return `${Math.floor(sec / 3600)} h ago`;
};
const STAGES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'loaded', label: 'Loaded', hint: 'Filled, still at the plant' },
  { key: 'left_plant', label: 'On the way', hint: 'Between the plant and the site' },
  { key: 'delayed', label: 'Delayed', hint: 'Held up on the road' },
  { key: 'reached_site', label: 'At site', hint: 'Waiting to pour' },
  { key: 'pouring', label: 'Pouring', hint: 'Discharging' },
  { key: 'returning', label: 'Returning', hint: 'Empty, heading back' },
];
const stageLabel = (s: unknown) => STAGES.find((x) => x.key === String(s))?.label ?? String(s ?? '').replace(/_/g, ' ');

interface TrackSummary { pings: number; pathKm: number; straightLineKm: number }

export default function LiveTrackingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fleet, setFleet] = useState<Row[]>([]);
  const [dispatches, setDispatches] = useState<Row[]>([]);
  const [track, setTrack] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [auto, setAuto] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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
    setLastRefresh(new Date());
  }, []);

  const reloadAll = useCallback(async () => {
    const [live, disp, fl] = await Promise.all([gpsApi.live(), dispatchApi.list(), gpsApi.fleet().catch(() => [] as Row[])]);
    setRows(live);
    setFleet(fl);
    setLastRefresh(new Date());
    setDispatches((Array.isArray(disp) ? disp : []).filter((d) => TRACKABLE.includes(String(d.dispatchStatus))));
  }, []);
  useEffect(() => {
    reloadAll()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reloadAll]);

  // Auto-refresh the live board.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(() => { loadLive().catch(() => {}); }, 15_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, loadLive]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reloadAll();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function recordPing(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (!dispatchId) { setError('Pick the load the fix is for.'); return; }
    if (lat === '' || lng === '') { setError('Enter the latitude and longitude, as the driver reads them off the phone.'); return; }
    setBusy(true);
    try {
      await gpsApi.ping(dispatchId, { latitude: Number(lat), longitude: Number(lng), speedKmph: speed ? Number(speed) : undefined, source: 'manual' });
      setMsg('Position recorded; the board shows it now.');
      setLat(''); setLng(''); setSpeed('');
      setShowForm(false);
      await reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function showTrack(id: string) {
    setError(null);
    try { setTrack(await gpsApi.track(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  const summary = (track?.summary as TrackSummary | undefined) ?? null;
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(String(r.dispatchStatus), (c.get(String(r.dispatchStatus)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => String(r.dispatchStatus) === filter) : rows;
  const stale = rows.filter((r) => Number(r.ageSeconds) > 900).length;

  return (
    <div className="mn-ord mn-lt">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Live tracking</h1>
          <p>Where every load on the road is right now, from the driver's phone (My Trips), a GPS vendor feed (Settings → GPS vendor feed) or a fix entered by hand. A customer asking "where is my concrete" gets an answer from here; a load that has not been seen for a while is the one to phone.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Navigation size={14} aria-hidden />
            {loaded ? `${rows.length} ${rows.length === 1 ? 'load' : 'loads'} on the road${lastRefresh ? ` · ${lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'Loading…'}
          </span>
          <label className="mn-se-switch mn-lt-auto">
            <input type="checkbox" role="switch" checked={auto} onChange={(e) => setAuto(e.target.checked)} aria-label="Refresh every 15 seconds" />
            <span className="mn-se-switch-track" aria-hidden><span className="mn-se-switch-knob" /></span>
            <span className="mn-se-switch-text">Every 15 s</span>
          </label>
          {canRecord && !showForm && <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>Record a position</Button>}
          <Link href="/app/dispatch/board" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Truck size={14} />}>Dispatch board</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {rows.length > 0 && (
        <div className="mn-board-strip" role="group" aria-label="Filter by status">
          {STAGES.filter((s) => counts.has(s.key)).map((s) => {
            const on = filter === s.key;
            return (
              <button key={s.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}`} data-tone={s.key === 'delayed' ? 'danger' : s.key === 'pouring' ? 'success' : 'info'} aria-pressed={on} title={s.hint} onClick={() => setFilter(on ? '' : s.key)}>
                <span className="mn-board-chip-n">{counts.get(s.key)}</span>
                <span className="mn-board-chip-l">{s.label}</span>
              </button>
            );
          })}
          {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
        </div>
      )}

      {loaded && stale > 0 && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <MapPin size={16} aria-hidden />
          <span><strong>{stale} {stale === 1 ? 'load has' : 'loads have'} not been seen for over 15 minutes.</strong> The device may be off or out of signal; phone the driver.</span>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canRecord && (
        <Card
          title={<span className="mn-board-card-title"><MapPin size={16} aria-hidden /> Record a position by hand</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={recordPing} className="mn-lt-form">
            <Field label="Load" required help="Only loads that are out are offered.">
              <Select value={dispatchId} onChange={(e) => setDispatchId(e.target.value)} required>
                <option value="">Choose…</option>
                {dispatches.map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.dispatchNo)} · {stageLabel(d.dispatchStatus)}</option>)}
              </Select>
            </Field>
            <Field label="Latitude" required help="From the driver's phone, e.g. 13.08268">
              <Input type="number" step="any" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} required />
            </Field>
            <Field label="Longitude" required help="e.g. 80.27072">
              <Input type="number" step="any" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} required />
            </Field>
            <Field label="Speed (km/h)">
              <Input type="number" step="any" inputMode="decimal" min={0} value={speed} onChange={(e) => setSpeed(e.target.value)} />
            </Field>
            <div className="mn-lt-form-submit">
              <Button type="submit" loading={busy} icon={<MapPin size={14} />}>Record</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">For a truck whose device is down; the fix is marked as entered by hand.</span>
            </div>
          </Form>
        </Card>
      )}

      {track && summary && (
        <Card
          title={<span className="mn-board-card-title"><Route size={16} aria-hidden /> Trip so far: {String(track.dispatchNo)}</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setTrack(null)}>Close</Button>}
        >
          <div className="mn-qr-sum mn-lt-sum">
            <span><strong>{summary.pings}</strong> {summary.pings === 1 ? 'fix' : 'fixes'}</span>
            <span><strong>{summary.pathKm}</strong> km driven</span>
            <span><strong>{summary.straightLineKm}</strong> km as the crow flies</span>
            {summary.straightLineKm > 0 && summary.pathKm / summary.straightLineKm > 1.6 ? <span className="mn-id-bad">a long way round for the distance</span> : null}
          </div>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Navigation size={16} aria-hidden /> On the road <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Newest fix first. The position opens in a map.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts mn-lt-cols" aria-hidden>
              <span>Load</span>
              <span>Truck</span>
              <span>Last seen</span>
              <span>Where</span>
              <span>Status</span>
              <span />
            </div>
            {[...shown].sort((a, b) => Number(a.ageSeconds) - Number(b.ageSeconds)).map((r) => {
              const status = String(r.dispatchStatus);
              const old = Number(r.ageSeconds) > 900;
              return (
                <div key={String(r.id)} className="mn-ord-row mn-ord-row--acts mn-lt-row" data-tone={status === 'delayed' || old ? 'danger' : status === 'pouring' ? 'success' : 'info'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.dispatchNo)}</span>
                    <span className="mn-ord-meta">{r.gradeLabel ? String(r.gradeLabel) : 'grade not set'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.vehicleNo ?? 'No truck')}</span>
                    <span className="mn-ord-meta">{r.lastSpeedKmph != null ? `${Number(r.lastSpeedKmph).toFixed(0)} km/h` : 'speed unknown'}</span>
                  </div>
                  <div className="mn-lt-seen">
                    <span className={old ? 'mn-id-bad' : ''}>{ageLabel(r.ageSeconds)}</span>
                    <span className="mn-ord-meta">{r.lastLocationAt ? formatDateTime(r.lastLocationAt) : ''}</span>
                  </div>
                  <div className="mn-lt-where">
                    <a href={`https://maps.google.com/?q=${coord(r.lastLatitude)},${coord(r.lastLongitude)}`} target="_blank" rel="noreferrer" className="mn-id-link">
                      <MapPin size={13} aria-hidden /> {coord(r.lastLatitude)}, {coord(r.lastLongitude)} <ExternalLink size={12} aria-hidden />
                    </a>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={status} /></div>
                  <div className="mn-ord-act mn-lt-acts">
                    <Button variant="ghost" size="sm" icon={<Route size={14} />} onClick={() => showTrack(String(r.id))}>Track</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title={filter ? `Nothing ${stageLabel(filter).toLowerCase()}` : 'No loads on the road'} description={filter ? 'Press the chip again to see every load.' : 'A dispatch appears here once it has left the plant and its device has sent a fix.'} action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button> : undefined} />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> Fleet — last known positions <span className="mn-board-card-count">{fleet.filter((v) => v.lastLocationAt).length}</span></span>}
        actions={<span className="mn-ord-how">Every truck that has ever reported, on a trip or idle. Newest fix first.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : fleet.some((v) => v.lastLocationAt) ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-lt-cols" aria-hidden>
              <span>Truck</span>
              <span>Driver</span>
              <span>Last seen</span>
              <span>Where</span>
              <span>Trip</span>
            </div>
            {fleet.filter((v) => v.lastLocationAt).map((v) => {
              const old = Number(v.ageSeconds) > 900;
              return (
                <div key={String(v.id)} className="mn-ord-row mn-lt-row" data-tone={v.dispatchNo ? (String(v.dispatchStatus) === 'delayed' ? 'danger' : 'info') : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(v.vehicleNo)}</span>
                    <span className="mn-ord-meta">{v.vehicleType ? String(v.vehicleType) : 'type not set'}{v.lastSpeedKmph != null ? ` · ${Number(v.lastSpeedKmph).toFixed(0)} km/h` : ''}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(v.driverName ?? 'No driver')}</span>
                    <span className="mn-ord-meta">{v.gpsDeviceId ? `device ${String(v.gpsDeviceId)}` : 'by registration'}</span>
                  </div>
                  <div className="mn-lt-seen">
                    <span className={old ? 'mn-id-bad' : ''}>{ageLabel(v.ageSeconds)}</span>
                    <span className="mn-ord-meta">{v.lastLocationAt ? formatDateTime(v.lastLocationAt) : ''}</span>
                  </div>
                  <div className="mn-lt-where">
                    <a href={`https://maps.google.com/?q=${coord(v.lastLatitude)},${coord(v.lastLongitude)}`} target="_blank" rel="noreferrer" className="mn-id-link">
                      <MapPin size={13} aria-hidden /> {coord(v.lastLatitude)}, {coord(v.lastLongitude)} <ExternalLink size={12} aria-hidden />
                    </a>
                  </div>
                  <div className="mn-ord-status">{v.dispatchNo ? <><span className="mn-ord-meta">{String(v.dispatchNo)}</span> <StatusBadge status={String(v.dispatchStatus)} /></> : <span className="mn-ord-meta">Idle</span>}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No truck has reported a position yet" description="Positions arrive from the driver's phone, a GPS vendor feed, or a fix entered by hand." />
        )}
      </Card>
    </div>
  );
}
