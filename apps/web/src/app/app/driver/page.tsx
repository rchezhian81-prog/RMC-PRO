'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, Phone, RefreshCw, Truck } from 'lucide-react';
import { driverApi, type DriverIdentity, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { StatusBadge } from '../../../components/ui/Badge';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { ErrorState, Loading } from '../../../components/ui/States';

/** Trip legs during which the phone streams its position. */
const TRACKABLE = ['loaded', 'left_plant', 'reached_site', 'pouring', 'returning', 'delayed'];
/** Seconds between two position sends while sharing is on. */
const SEND_EVERY_S = 20;

const STAGE_LABEL: Record<string, string> = {
  waiting: 'Waiting at plant', loaded: 'Loaded — ready to leave', left_plant: 'On the road', reached_site: 'At site',
  pouring: 'Pouring', delayed: 'Delayed', returning: 'Returning to plant', completed: 'Done', rejected: 'Rejected', cancelled: 'Cancelled',
};

/** The one big button for each leg, and the smaller side moves. */
const NEXT: Record<string, { status: string; label: string }[]> = {
  loaded: [{ status: 'left_plant', label: 'Left the plant' }],
  left_plant: [{ status: 'reached_site', label: 'Reached the site' }],
  reached_site: [{ status: 'pouring', label: 'Started pouring' }],
  pouring: [{ status: 'completed', label: 'Pour finished' }],
  delayed: [
    { status: 'reached_site', label: 'Reached the site' },
    { status: 'pouring', label: 'Started pouring' },
    { status: 'completed', label: 'Pour finished' },
  ],
  returning: [{ status: 'completed', label: 'Back at plant' }],
};

const timeOf = (v: unknown) => {
  if (!v) return null;
  try { return new Date(String(v)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return null; }
};
const qty = (v: unknown) => `${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} m³`;
const mapsHref = (t: Row) => {
  const q = [t.siteName, t.siteAddress, t.siteCity].filter(Boolean).map(String).join(', ');
  return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : null;
};

export default function DriverTripsPage() {
  const { prompt } = useConfirm();
  const [me, setMe] = useState<DriverIdentity | null>(null);
  const [trips, setTrips] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSendAt = useRef(0);
  const tripsRef = useRef<Row[]>([]);
  tripsRef.current = trips;

  const reload = useCallback(async () => {
    const [m, t] = await Promise.all([driverApi.me(), driverApi.trips()]);
    setMe(m);
    setTrips(t);
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoaded(true));
    const timer = setInterval(() => { reload().catch(() => {}); }, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  // Position sharing: one browser watch; a fix goes to every trip that is on the road, at most every SEND_EVERY_S.
  useEffect(() => {
    if (!sharing) {
      if (watchId.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeoError('This phone or browser has no location service.'); setSharing(false); return; }
    setGeoError(null);
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastSendAt.current < SEND_EVERY_S * 1000) return;
        const live = tripsRef.current.filter((t) => TRACKABLE.includes(String(t.dispatchStatus)));
        if (!live.length) return;
        lastSendAt.current = now;
        const fix = {
          latitude: pos.coords.latitude, longitude: pos.coords.longitude,
          speedKmph: pos.coords.speed != null && pos.coords.speed >= 0 ? Math.round(pos.coords.speed * 3.6) : undefined,
          heading: pos.coords.heading != null && Number.isFinite(pos.coords.heading) ? pos.coords.heading : undefined,
          accuracyM: pos.coords.accuracy, recordedAt: new Date(pos.timestamp).toISOString(),
        };
        try {
          for (const t of live) {
            const r = await driverApi.location(String(t.id), fix);
            if (!r.recorded && r.reason) setGeoError(r.reason);
          }
          setLastSent(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        } catch (e) {
          setGeoError(e instanceof Error ? e.message : 'Could not send the location');
        }
      },
      (err) => setGeoError(err.code === err.PERMISSION_DENIED ? 'Location permission was refused — allow location for this site in the phone settings.' : err.message),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => {
      if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [sharing]);

  async function move(t: Row, status: string, extra: Record<string, unknown> = {}, okMsg?: string) {
    setError(null); setMsg(null);
    try {
      await driverApi.setStatus(String(t.id), status, extra);
      await reload();
      setMsg(okMsg ?? `${String(t.dispatchNo)}: ${STAGE_LABEL[status] ?? status}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the trip');
    }
  }

  async function markDelayed(t: Row) {
    const reason = await prompt({ title: `${String(t.dispatchNo)} delayed`, message: 'Tell the office why (traffic, breakdown, site not ready…).', label: 'Reason', defaultValue: '' });
    if (reason === null) return;
    await move(t, 'delayed', { delayReason: reason || 'Delayed' }, `${String(t.dispatchNo)} marked delayed — the office can see it.`);
  }

  async function markReturning(t: Row) {
    const q = await prompt({ title: `${String(t.dispatchNo)} — concrete coming back`, message: 'How many m³ are you bringing back? Leave blank if unsure.', label: 'Returned m³', defaultValue: '' });
    if (q === null) return;
    const extra: Record<string, unknown> = {};
    if (q.trim() !== '') extra.returnQuantityM3 = Number(q);
    await move(t, 'returning', extra, `${String(t.dispatchNo)}: returning to plant.`);
  }

  if (!loaded) return <Loading label="Loading your trips…" />;

  const open = trips.filter((t) => t.open);
  const done = trips.filter((t) => !t.open);
  const big: React.CSSProperties = { minHeight: 52, fontSize: 16, width: '100%', justifyContent: 'center' };

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>My Trips</h1>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={() => reload().catch((e) => setError(String(e)))}>Refresh</Button>
      </div>

      {me && !me.linked && (
        <Card title="Not linked yet">
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>{me.message}</p>
        </Card>
      )}

      {me?.linked && (
        <Card>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Truck size={22} />
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{me.driver?.driverName}</div>
              <div style={{ color: 'var(--mn-muted)', fontSize: 13 }}>{me.vehicle ? `Vehicle ${me.vehicle.vehicleNo}` : 'No vehicle assigned in the master'} · {me.driver?.driverCode}</div>
            </div>
            {me.gpsEnabled ? (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, cursor: 'pointer', minHeight: 44 }}>
                <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--mn-primary)' }} />
                <Navigation size={16} /> Share my location
              </label>
            ) : (
              <span style={{ fontSize: 12.5, color: 'var(--mn-muted)' }}>Location sharing is not in this company&apos;s plan.</span>
            )}
          </div>
          {sharing && (
            <p style={{ margin: '10px 0 0', fontSize: 13, color: geoError ? 'var(--mn-danger)' : 'var(--mn-muted)' }}>
              {geoError ?? (lastSent ? `Location on · last sent ${lastSent}` : open.some((t) => TRACKABLE.includes(String(t.dispatchStatus))) ? 'Location on · waiting for the first fix…' : 'Location on · sends once a trip is on the road')}
            </p>
          )}
        </Card>
      )}

      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 14, margin: 0 }}>{msg}</p>
      )}

      {me?.linked && open.length === 0 && (
        <Card title="No trips right now">
          <p style={{ margin: 0, fontSize: 15, color: 'var(--mn-muted)' }}>When the office loads a truck against your name it appears here. Pull down or press Refresh.</p>
        </Card>
      )}

      {open.map((t) => {
        const status = String(t.dispatchStatus);
        const next = NEXT[status] ?? [];
        const maps = mapsHref(t);
        return (
          <Card key={String(t.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{String(t.dispatchNo)}</div>
                <div style={{ fontSize: 15, marginTop: 2 }}>{String(t.gradeLabel ?? '')} · {qty(t.quantityM3)}{t.vehicleNo ? ` · ${String(t.vehicleNo)}` : ''}</div>
              </div>
              <StatusBadge status={status} />
            </div>
            <div style={{ marginTop: 10, fontSize: 15, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600 }}>{String(t.customerName ?? '—')}</div>
              <div>{String(t.siteName ?? '')}{t.siteCity ? `, ${String(t.siteCity)}` : ''}</div>
              {t.siteAddress ? <div style={{ color: 'var(--mn-muted)', fontSize: 13.5 }}>{String(t.siteAddress)}</div> : null}
              {t.challanNo ? <div style={{ color: 'var(--mn-muted)', fontSize: 13.5 }}>Challan {String(t.challanNo)}</div> : null}
              {Boolean(t.delayReason) && status === 'delayed' ? <div style={{ color: 'var(--mn-warning)', fontSize: 13.5 }}>Delayed: {String(t.delayReason)}</div> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {maps && (
                <a href={maps} target="_blank" rel="noreferrer" className="mn-btn mn-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', borderRadius: 'var(--mn-radius-md)', border: '1px solid var(--mn-border)', textDecoration: 'none', color: 'var(--mn-text)', fontSize: 14 }}>
                  <MapPin size={15} /> Directions
                </a>
              )}
              {Boolean(t.siteMobile || t.customerMobile) && (
                <a href={`tel:${String(t.siteMobile || t.customerMobile)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', borderRadius: 'var(--mn-radius-md)', border: '1px solid var(--mn-border)', textDecoration: 'none', color: 'var(--mn-text)', fontSize: 14 }}>
                  <Phone size={15} /> Call site{t.siteContact ? ` (${String(t.siteContact)})` : ''}
                </a>
              )}
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {status === 'waiting' && <p style={{ margin: 0, fontSize: 14, color: 'var(--mn-muted)' }}>Waiting for the plant to load this truck.</p>}
              {next.map((n) => (
                <Button key={n.status} style={big} onClick={() => move(t, n.status)}>{n.label}</Button>
              ))}
              {status !== 'waiting' && status !== 'delayed' && status !== 'returning' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" style={{ ...big, minHeight: 44, fontSize: 14 }} onClick={() => markDelayed(t)}>Delayed</Button>
                  <Button variant="secondary" style={{ ...big, minHeight: 44, fontSize: 14 }} onClick={() => markReturning(t)}>Concrete coming back</Button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5, color: 'var(--mn-muted)' }}>
              {timeOf(t.dispatchTime) && <span>Left {timeOf(t.dispatchTime)}</span>}
              {timeOf(t.siteArrivalTime) && <span>Site {timeOf(t.siteArrivalTime)}</span>}
              {timeOf(t.pourStartTime) && <span>Pour {timeOf(t.pourStartTime)}</span>}
            </div>
          </Card>
        );
      })}

      {done.length > 0 && (
        <Card title="Done today">
          <div style={{ display: 'grid', gap: 8 }}>
            {done.map((t) => (
              <div key={String(t.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, borderBottom: '1px solid var(--mn-border)', paddingBottom: 6 }}>
                <span><strong>{String(t.dispatchNo)}</strong> · {String(t.customerName ?? '')} · {qty(t.quantityM3)}</span>
                <span style={{ color: 'var(--mn-muted)' }}>{timeOf(t.pourEndTime) ?? ''}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
