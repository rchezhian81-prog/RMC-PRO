'use client';

import { useCallback, useEffect, useState } from 'react';
import { syncApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { getAccess } from '../../../lib/session';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

const dt = (v: unknown) => (v ? String(v).slice(0, 19).replace('T', ' ') : '—');

export default function DevicesSyncPage() {
  const [devices, setDevices] = useState<Row[]>([]);
  const [reservations, setReservations] = useState<Row[]>([]);
  const [conflicts, setConflicts] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Every /sync route now requires sync.manage — without it the reads 403, so
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

  async function setDevice(id: string, name: string, active: boolean) {
    setError(null);
    setMsg(null);
    try {
      if (!active && !(await confirm({
        title: 'Revoke device',
        message: `Revoke ${name}? It keeps its documents and number blocks but can no longer bootstrap, reserve numbers, push or pull. Registering it again will not restore it — use Reactivate.`,
        confirmLabel: 'Revoke',
      }))) return;
      await (active ? syncApi.reactivateDevice(id) : syncApi.deactivateDevice(id));
      setMsg(`${name} ${active ? 'reactivated' : 'revoked'}.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function resolve(id: string, resolution: string) {
    setError(null);
    setMsg(null);
    try {
      await syncApi.resolveConflict(id, resolution);
      setMsg(`Conflict resolved (${resolution}).`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Devices &amp; Sync</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>Registered plant devices, cloud-issued number reservations, and offline↔cloud conflicts.</p>
      </div>
      {!canManage && (
        <ErrorState message="Devices & Sync needs the sync.manage permission — ask an administrator to grant it or to manage devices for you." />
      )}
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      <Card title="Devices" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : devices.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Identifier</Th>
                <Th>Status</Th>
                <Th>Last sync</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <Td style={{ fontWeight: 600 }}>{String(d.deviceName ?? '')}</Td>
                  <Td>{String(d.deviceType ?? '')}</Td>
                  <Td>{String(d.deviceIdentifier ?? '')}</Td>
                  <Td><StatusBadge status={String(d.status ?? '')} /></Td>
                  <Td>{dt(d.lastSyncToken)}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDevice(String(d.id), String(d.deviceName ?? 'device'), String(d.status) !== 'active')}
                    >
                      {String(d.status) === 'active' ? 'Revoke' : 'Reactivate'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No devices registered" />
        )}
      </Card>

      <Card title="Number reservations" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : reservations.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Prefix</Th>
                <Th numeric>From</Th>
                <Th numeric>To</Th>
                <Th numeric>Used</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <Td>{String(r.documentType ?? '')}</Td>
                  <Td>{String(r.prefix ?? '')}</Td>
                  <Td numeric>{String(r.numberFrom)}</Td>
                  <Td numeric>{String(r.numberTo)}</Td>
                  <Td numeric>{String(r.usedCount)}</Td>
                  <Td><StatusBadge status={String(r.status)} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No reservations" />
        )}
      </Card>

      <Card title="Sync conflicts" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : conflicts.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Entity</Th>
                <Th>Reason</Th>
                <Th>Cloud ID</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.id}>
                  <Td>{String(c.entityName ?? '')}</Td>
                  <Td>{String(c.conflictReason ?? '')}</Td>
                  <Td><code style={{ fontSize: 11 }}>{String(c.cloudId ?? '—').slice(0, 8)}</code></Td>
                  <Td><StatusBadge status={String(c.resolutionStatus)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    {c.resolutionStatus === 'pending' && (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <Button size="sm" onClick={() => resolve(String(c.id), 'keep_cloud')}>Keep cloud</Button>
                        <Button variant="secondary" size="sm" onClick={() => resolve(String(c.id), 'keep_local')}>Keep local</Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No conflicts" description="Offline↔cloud sync conflicts will appear here." />
        )}
      </Card>
    </div>
  );
}
