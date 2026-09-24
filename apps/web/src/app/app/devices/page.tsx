'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, HardDrive, Hash, MonitorSmartphone, RefreshCw, ShieldOff } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../lib/format-date';
import { syncApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { getAccess } from '../../../lib/session';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

/**
 * Devices and sync — the plant PCs that work offline, and what they hold.
 *
 * A pill counts the live devices and the conflicts waiting, notes name the
 * conflicts to settle and the revoked devices, and three cards follow. Each
 * device is one row: name and identifier; plant and who registered it; when
 * it last synced; the number blocks and conflicts it holds; its status;
 * Revoke / Reactivate. Each number block is one row with the range and how
 * much of it is used, on a bar. Each conflict is one row: what and where;
 * the device; why in plain words; the status; Keep cloud / Keep local with
 * a dialog that says which version wins. Same layout in both skins; every
 * colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const DOC_LABELS: Record<string, string> = {
  delivery_challan: 'Delivery challan', batch_ticket: 'Batch ticket', invoice: 'Invoice', order: 'Order', quotation: 'Quotation',
  dispatch: 'Dispatch', receipt: 'Receipt', qc_cube_set: 'Cube set', rate_contract: 'Rate contract', expense_voucher: 'Expense voucher',
  maintenance_job: 'Maintenance job', vendor_bill: 'Supplier bill', purchase_order: 'Purchase order', goods_receipt: 'Goods receipt',
};
const docLabel = (v: unknown) => DOC_LABELS[String(v ?? '')] ?? String(v ?? '').replace(/_/g, ' ');
const DEVICE_TYPES: Record<string, string> = { standalone_plant_app: 'Plant app (offline)', tablet: 'Tablet', mobile: 'Phone' };
const deviceType = (v: unknown) => DEVICE_TYPES[String(v ?? '')] ?? String(v ?? '').replace(/_/g, ' ');
const RESOLUTIONS: Record<string, string> = { keep_cloud: 'kept the cloud version', keep_local: 'kept the device version' };

export default function DevicesSyncPage() {
  const [devices, setDevices] = useState<Row[]>([]);
  const [reservations, setReservations] = useState<Row[]>([]);
  const [conflicts, setConflicts] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Every /sync route requires sync.manage — without it the reads 403, so
  // say that plainly instead of rendering a raw error.
  const canManage = getAccess().has('sync.manage');
  const { confirm } = useConfirm();

  const reload = useCallback(async () => {
    const [d, r, c] = await Promise.all([syncApi.devices(), syncApi.reservations(), syncApi.conflicts()]);
    setDevices(d);
    setReservations(r);
    setConflicts(c);
  }, []);
  useEffect(() => {
    if (!canManage) { setLoaded(true); return; }
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload, canManage]);

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

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      await reload();
      setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function setDevice(d: Row, active: boolean) {
    const name = String(d.deviceName ?? 'device');
    if (!active && !(await confirm({
      title: `Revoke ${name}`,
      message: `The device keeps its documents and its number blocks but can no longer sign in to the cloud, reserve numbers, push or pull. Registering it again will not restore it; use Reactivate here.`,
      confirmLabel: 'Revoke',
      danger: true,
    }))) return;
    await run(() => (active ? syncApi.reactivateDevice(String(d.id)) : syncApi.deactivateDevice(String(d.id))), `${name} ${active ? 'reactivated; it can sync again' : 'revoked'}.`);
  }

  async function resolve(c: Row, resolution: 'keep_cloud' | 'keep_local') {
    const what = `${docLabel(c.entityName)} ${String(c.localId ?? '')}`.trim();
    if (!(await confirm({
      title: resolution === 'keep_cloud' ? `Keep the cloud version of ${what}` : `Keep the device version of ${what}`,
      message: resolution === 'keep_cloud'
        ? 'The version in the cloud stands; the device\'s copy is overwritten on its next sync.'
        : 'The version from the device stands; the cloud copy is replaced with it.',
      confirmLabel: resolution === 'keep_cloud' ? 'Keep cloud' : 'Keep device',
    }))) return;
    await run(() => syncApi.resolveConflict(String(c.id), resolution), `${what}: ${RESOLUTIONS[resolution]}.`);
  }

  const live = devices.filter((d) => String(d.status) === 'active');
  const revoked = devices.filter((d) => String(d.status) !== 'active');
  const pending = useMemo(() => conflicts.filter((c) => String(c.resolutionStatus) === 'pending'), [conflicts]);
  const sortedConflicts = useMemo(() => [...conflicts].sort((a, b) => (a.resolutionStatus === 'pending' ? 0 : 1) - (b.resolutionStatus === 'pending' ? 0 : 1)), [conflicts]);

  return (
    <div className="mn-ord mn-dv">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Devices and sync</h1>
          <p>The plant PCs and tablets that keep working when the internet does not. Each one is registered here, is issued its own blocks of document numbers so nothing clashes, and pushes its work up when it reconnects. When the same document was changed in both places, the conflict waits here for a decision.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <MonitorSmartphone size={14} aria-hidden />
            {loaded ? `${live.length} live ${live.length === 1 ? 'device' : 'devices'} · ${pending.length} ${pending.length === 1 ? 'conflict' : 'conflicts'} waiting` : 'Loading…'}
          </span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing} disabled={!canManage}>
            Refresh
          </Button>
        </div>
      </header>

      {!canManage && (
        <ErrorState message="Devices and sync needs the sync.manage permission. Ask an administrator to grant it or to manage devices for you." />
      )}
      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {loaded && canManage && (pending.length > 0 || revoked.length > 0) && (
        <div className="mn-ord-notes">
          {pending.length > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <AlertTriangle size={16} aria-hidden />
              <span><strong>{pending.length} {pending.length === 1 ? 'conflict is' : 'conflicts are'} waiting for a decision.</strong> Until it is settled the device and the cloud disagree about that document; pick the version that matches the paper.</span>
            </div>
          )}
          {revoked.length > 0 && (
            <div className="mn-ord-note" role="status">
              <ShieldOff size={16} aria-hidden />
              <span><strong>{revoked.length} {revoked.length === 1 ? 'device is' : 'devices are'} revoked:</strong> {revoked.map((d) => String(d.deviceName)).join(', ')}. A revoked device cannot sync; reactivate it if it is back in use.</span>
            </div>
          )}
        </div>
      )}

      <Card
        title={<span className="mn-board-card-title"><HardDrive size={16} aria-hidden /> Devices <span className="mn-board-card-count">{devices.length}</span></span>}
        actions={<span className="mn-ord-how">A device registers itself from the plant app with the identifier on its screen.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : devices.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Device</span>
              <span>Where</span>
              <span>Last synced</span>
              <span>Holds</span>
              <span>Status</span>
              <span />
            </div>
            {devices.map((d) => {
              const active = String(d.status) === 'active';
              return (
                <div key={String(d.id)} className={`mn-ord-row mn-ord-row--acts mn-dv-row${active ? '' : ' is-void'}`} data-tone={active ? (num(d.pendingConflicts) ? 'warning' : 'success') : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(d.deviceName ?? '')}</span>
                    <span className="mn-ord-meta">{String(d.deviceIdentifier ?? '')}<span className="mn-ord-dot" aria-hidden>·</span>{deviceType(d.deviceType)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{d.plantName ? String(d.plantName) : 'No plant'}</span>
                    <span className="mn-ord-meta">registered {formatDate(d.createdAt)}{d.registeredByName ? ` by ${String(d.registeredByName)}` : ''}</span>
                  </div>
                  <div className="mn-dv-sync">
                    <span>{d.lastSyncToken ? formatDateTime(d.lastSyncToken) : 'Never synced'}</span>
                    <span className="mn-ord-meta">{d.lastSeenAt ? `seen ${formatDateTime(d.lastSeenAt)}` : 'never seen'}</span>
                  </div>
                  <div className="mn-dv-holds">
                    <span>{num(d.reservationCount)} number {num(d.reservationCount) === 1 ? 'block' : 'blocks'}</span>
                    <span className={`mn-ord-meta${num(d.pendingConflicts) ? ' mn-id-bad' : ''}`}>{num(d.pendingConflicts) ? `${num(d.pendingConflicts)} ${num(d.pendingConflicts) === 1 ? 'conflict' : 'conflicts'} waiting` : 'no conflicts'}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={active ? 'active' : 'revoked'} /></div>
                  <div className="mn-ord-act mn-dv-acts">
                    <Button variant={active ? 'ghost' : 'secondary'} size="sm" disabled={busy} onClick={() => setDevice(d, !active)}>{active ? 'Revoke' : 'Reactivate'}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No devices registered" description="Install the plant app on the batching PC and register it; it appears here with the identifier on its screen." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Hash size={16} aria-hidden /> Number blocks <span className="mn-board-card-count">{reservations.length}</span></span>}
        actions={<span className="mn-ord-how">A block is a run of document numbers only that device may use, so offline work never clashes with the cloud.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : reservations.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-dv-rcols" aria-hidden>
              <span>Document</span>
              <span>Device</span>
              <span>Used</span>
              <span>Expires</span>
              <span>Status</span>
            </div>
            {reservations.map((r) => {
              const size = num(r.numberTo) - num(r.numberFrom) + 1;
              const used = num(r.usedCount);
              const pad = num(r.paddingLength) || 4;
              const fmt = (n: number) => `${String(r.prefix ?? '')}${String(n).padStart(pad, '0')}`;
              return (
                <div key={String(r.id)} className="mn-ord-row mn-dv-rrow" data-tone={String(r.status) === 'active' ? 'info' : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{docLabel(r.documentType)}</span>
                    <span className="mn-ord-meta">{fmt(num(r.numberFrom))} to {fmt(num(r.numberTo))}{r.financialYear ? ` · FY ${String(r.financialYear)}` : ''}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{r.deviceName ? String(r.deviceName) : 'No device'}</span>
                    <span className="mn-ord-meta">issued {formatDate(r.createdAt)}</span>
                  </div>
                  <div className="mn-dv-used">
                    <span>{used} of {size} used</span>
                    <span className="mn-od-linebar mn-dv-bar" aria-hidden><span style={{ width: `${size ? Math.min(100, (used / size) * 100) : 0}%` }} /></span>
                  </div>
                  <div className="mn-dv-exp">
                    <span>{r.expiresAt ? formatDate(r.expiresAt) : 'No expiry'}</span>
                    <span className="mn-ord-meta">{r.expiresAt ? 'unused numbers return after this' : ''}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={String(r.status)} /></div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No number blocks issued" description="A device asks for a block when it first goes offline; nothing is issued until then." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Cloud size={16} aria-hidden /> Sync conflicts <span className="mn-board-card-count">{conflicts.length}</span></span>}
        actions={<span className="mn-ord-how">Waiting ones first. Keep the version that matches the paper in the office.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : sortedConflicts.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts mn-dv-ccols" aria-hidden>
              <span>Document</span>
              <span>Device</span>
              <span>What happened</span>
              <span>Status</span>
              <span />
            </div>
            {sortedConflicts.map((c) => {
              const waiting = String(c.resolutionStatus) === 'pending';
              return (
                <div key={String(c.id)} className="mn-ord-row mn-ord-row--acts mn-dv-crow" data-tone={waiting ? 'warning' : 'success'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{docLabel(c.entityName)}</span>
                    <span className="mn-ord-meta">{c.localId ? `on the device as ${String(c.localId)}` : 'no local id'}{c.cloudId ? ` · in the cloud` : ' · not in the cloud'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{c.deviceName ? String(c.deviceName) : 'Unknown device'}</span>
                    <span className="mn-ord-meta">{formatDateTime(c.createdAt)}</span>
                  </div>
                  <div className="mn-dv-reason">
                    <span>{c.conflictReason ? String(c.conflictReason) : 'The device and the cloud disagree about this document.'}</span>
                  </div>
                  <div className="mn-ord-status mn-dv-cstatus">
                    {waiting ? <Badge tone="warning">waiting</Badge> : <Badge tone="success">{RESOLUTIONS[String(c.resolutionStatus)] ?? String(c.resolutionStatus).replace(/_/g, ' ')}</Badge>}
                    {!waiting && c.resolvedAt ? <span className="mn-ord-meta">{formatDateTime(c.resolvedAt)}</span> : null}
                  </div>
                  <div className="mn-ord-act mn-dv-acts">
                    {waiting && (
                      <>
                        <Button size="sm" icon={<Cloud size={14} />} disabled={busy} onClick={() => resolve(c, 'keep_cloud')}>Keep cloud</Button>
                        <Button variant="secondary" size="sm" icon={<HardDrive size={14} />} disabled={busy} onClick={() => resolve(c, 'keep_local')}>Keep device</Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No conflicts" description="A conflict appears when the same document was changed on a device and in the cloud before they synced. None so far." />
        )}
      </Card>
    </div>
  );
}
