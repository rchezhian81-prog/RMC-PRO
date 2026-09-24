'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, MessageSquare, RefreshCw } from 'lucide-react';
import { formatDateTime } from '../../../lib/format-date';
import { notificationsApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ExportButton } from '../../../components/ExportButton';
import { StatusBadge } from '../../../components/ui/Badge';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * WhatsApp log — every share sent from the app, on record.
 *
 * A module strip with live counts doubles as the filter and each send is
 * one row: when; who it went to with what was shared; the message as it
 * was sent; the status; and Open, which reopens the chat. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const MODULES: Record<string, string> = { sales: 'Sales', billing: 'Billing', dispatch: 'Dispatch', purchase: 'Purchase', expenses: 'Expenses' };
const moduleLabel = (v: unknown) => MODULES[String(v ?? '')] ?? (v ? String(v).replace(/_/g, ' ') : 'Other');
const EVENTS: Record<string, string> = {
  quotation_share: 'Quotation', invoice_share: 'Invoice', challan_share: 'Delivery challan', receipt_share: 'Receipt',
  credit_note_share: 'Credit note', purchase_order_share: 'Purchase order', reminder: 'Payment reminder', statement: 'Statement',
};
const eventLabel = (v: unknown) => EVENTS[String(v ?? '')] ?? (v ? String(v).replace(/_share$/, '').replace(/_/g, ' ') : 'Message');
const mobile = (v: unknown) => { const s = String(v ?? '').replace(/\D/g, ''); return s.length === 10 ? `${s.slice(0, 5)} ${s.slice(5)}` : s || '—'; };

export default function NotificationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRows(await notificationsApi.history());
  }, []);
  useEffect(() => {
    setLoaded(false);
    load()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(String(r.moduleKey ?? 'other'), (c.get(String(r.moduleKey ?? 'other')) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => String(r.moduleKey ?? 'other') === filter) : rows;

  return (
    <div className="mn-ord mn-wa">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>WhatsApp log</h1>
          <p>Every share sent from the app: quotations, challans, invoices, receipts and reminders. What went out, to which number, and the message word for word, so nobody has to ask what the customer was sent.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <MessageSquare size={14} aria-hidden />
            {loaded ? `${shown.length} ${shown.length === 1 ? 'send' : 'sends'}${filter ? ` from ${moduleLabel(filter)}` : ''}` : 'Loading…'}
          </span>
          <ExportButton rows={rows} columns={['createdAt', 'moduleKey', 'eventKey', 'recipientMobile', 'messageStatus', 'messageBody']} filename="whatsapp-send-log" />
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {counts.size > 0 && (
        <div className="mn-board-strip" role="group" aria-label="Filter by module">
          {[...counts.entries()].map(([k, c]) => {
            const on = filter === k;
            return (
              <button key={k} type="button" className={`mn-board-chip${on ? ' is-on' : ''}`} data-tone="info" aria-pressed={on} onClick={() => setFilter(on ? '' : k)}>
                <span className="mn-board-chip-n">{c}</span>
                <span className="mn-board-chip-l">{moduleLabel(k)}</span>
              </button>
            );
          })}
          {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <Card
        title={<span className="mn-board-card-title"><MessageSquare size={16} aria-hidden /> Sends <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Newest first. Open reopens the chat with the same message.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Sent</span>
              <span>To</span>
              <span>Message</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((r) => (
              <div key={String(r.id)} className="mn-ord-row mn-ord-row--acts mn-wa-row" data-tone={String(r.messageStatus) === 'failed' ? 'danger' : 'success'} role="listitem">
                <div className="mn-ord-id">
                  <span className="mn-ord-no">{formatDateTime(r.createdAt)}</span>
                  <span className="mn-ord-meta">{moduleLabel(r.moduleKey)}<span className="mn-ord-dot" aria-hidden>·</span>{eventLabel(r.eventKey)}</span>
                </div>
                <div className="mn-ord-who">
                  <span className="mn-ord-cust">{mobile(r.recipientMobile)}</span>
                  <span className="mn-ord-meta">{r.errorMessage ? String(r.errorMessage) : 'WhatsApp'}</span>
                </div>
                <div className="mn-wa-msg">
                  <span>{r.messageBody ? String(r.messageBody) : <span className="mn-ord-meta">No message text</span>}</span>
                </div>
                <div className="mn-ord-status"><StatusBadge status={String(r.messageStatus === 'queued' ? 'shared' : r.messageStatus ?? '')} /></div>
                <div className="mn-ord-act mn-wa-acts">
                  {r.shareUrl ? (
                    <a href={String(r.shareUrl)} target="_blank" rel="noopener noreferrer" className="mn-ord-link">
                      <Button variant="ghost" size="sm" icon={<ExternalLink size={14} />}>Open</Button>
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={filter ? `Nothing from ${moduleLabel(filter)}` : 'No sends yet'} description={filter ? 'Press the chip again to see every module.' : 'Press Send on a quotation, challan, invoice or receipt and the share is recorded here.'} action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button> : undefined} />
        )}
      </Card>
    </div>
  );
}
