'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, Share2 } from 'lucide-react';
import { challansApi, openPdf, type Row } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--mn-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 15, marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  );
}

export default function ChallanDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { prompt } = useConfirm();
  const [c, setC] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setC(await challansApi.get(id));
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await load();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (!c) return <Loading label="Loading challan…" />;
  const history = (c.history as Row[]) ?? [];
  const status = String(c.challanStatus);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/app/dispatch/challans')}>
          Delivery Challans
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{String(c.challanNo)}</h1>
        <StatusBadge status={status} />
        <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>invoice {String(c.invoiceStatus)}</span>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <div style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}

      <Card title="Challan">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 20 }}>
          <Info label="Grade" value={String(c.gradeLabel ?? '—')} />
          <Info label="Quantity m³" value={money(c.quantityM3)} />
          <Info label="Slump" value={String(c.slump ?? '—')} />
          <Info label="Receiver" value={String(c.receiverName ?? '—')} />
          <Info label="Return m³" value={money(c.returnQuantityM3)} />
        </div>
      </Card>

      <Card title="Actions">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {status === 'draft' && <Button onClick={() => run(() => challansApi.issue(id), 'Challan issued')}>Issue</Button>}
          {status === 'issued' && (
            <Button
              onClick={() =>
                run(async () => {
                  const receiver = await prompt({ title: 'Mark delivered', label: 'Receiver name', defaultValue: 'Site Engineer' });
                  if (receiver === null) return;
                  const ret = await prompt({ title: 'Mark delivered', label: 'Return quantity (m³)', defaultValue: '0', type: 'number' });
                  if (ret === null) return;
                  await challansApi.deliver(id, { receiverName: receiver, returnQuantityM3: Number(ret || 0) });
                }, 'Marked delivered')
              }
            >
              Mark delivered
            </Button>
          )}
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => openPdf(`/delivery-challans/${id}/pdf`).catch((e) => setError(String(e)))}>
            Download PDF
          </Button>
          <Button
            variant="secondary"
            icon={<Share2 size={16} />}
            onClick={() =>
              run(async () => {
                const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile (WhatsApp)', defaultValue: '' });
                if (m !== null) await challansApi.share(id, m);
              }, 'WhatsApp message logged')
            }
          >
            Share on WhatsApp
          </Button>
          {(status === 'draft' || status === 'issued') && (
            <Button
              variant="secondary"
              onClick={() =>
                run(async () => {
                  const reason = await prompt({ title: 'Cancel challan', label: 'Cancel reason', defaultValue: '' });
                  if (reason !== null) await challansApi.cancel(id, reason);
                }, 'Challan cancelled')
              }
            >
              Cancel
            </Button>
          )}
        </div>
      </Card>

      <Card title="Status history" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>From → To</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <Td>{String(h.createdAt ?? '').slice(0, 19).replace('T', ' ')}</Td>
                <Td>
                  {String(h.oldStatus ?? '—')} → {String(h.newStatus)}
                </Td>
                <Td>{String(h.note ?? '—')}</Td>
              </tr>
            ))}
            {!history.length && (
              <tr>
                <Td colSpan={3} style={{ color: 'var(--mn-muted)' }}>No history.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
