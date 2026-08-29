'use client';

import { useEffect, useState } from 'react';
import { notificationsApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { ExportButton } from '../../../components/ExportButton';
import { StatusBadge } from '../../../components/ui/Badge';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

const when = (v: unknown) => { try { return new Date(v as string).toLocaleString('en-IN'); } catch { return String(v ?? ''); } };

export default function NotificationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setError(null);
    setRows(await notificationsApi.history());
  }
  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>WhatsApp Send Log</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Every outbound WhatsApp share is recorded here — what was sent, to whom, and from which module. Most recent first.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card
        title={`Sends${rows.length ? ` — ${rows.length}` : ''}`}
        padded={false}
        actions={<ExportButton rows={rows} columns={['createdAt', 'moduleKey', 'eventKey', 'recipientMobile', 'messageStatus', 'messageBody']} filename="whatsapp-send-log" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Module</Th>
                  <Th>Event</Th>
                  <Th>To</Th>
                  <Th>Status</Th>
                  <Th>Message</Th>
                  <Th>Open</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td>{when(r.createdAt)}</Td>
                    <Td>{String(r.moduleKey ?? '')}</Td>
                    <Td>{r.eventKey ? String(r.eventKey) : <span style={{ color: 'var(--mn-muted)' }}>—</span>}</Td>
                    <Td>{r.recipientMobile ? String(r.recipientMobile) : <span style={{ color: 'var(--mn-muted)' }}>—</span>}</Td>
                    <Td><StatusBadge status={String(r.messageStatus ?? '')} /></Td>
                    <Td style={{ maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(r.messageBody ?? '')}>
                      {String(r.messageBody ?? '')}
                    </Td>
                    <Td>
                      {r.shareUrl ? (
                        <a href={String(r.shareUrl)} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="sm">Open</Button>
                        </a>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No sends yet" description="WhatsApp shares from quotations, challans, invoices and receipts appear here." />
        )}
      </Card>
    </div>
  );
}
