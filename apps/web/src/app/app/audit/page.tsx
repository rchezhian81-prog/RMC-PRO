'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PenLine, RefreshCw, ScrollText, Search, X } from 'lucide-react';
import { formatDateTime } from '../../../lib/format-date';
import { auditApi, type AuditEntry } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * Audit trail — the permanent record of the actions that matter.
 *
 * A search box finds events by what happened or who did it, an area strip
 * with live counts (money, sales, stock and production, masters and
 * settings, people and access, corrections) filters the events on screen,
 * and each event is one row: when; who; what happened with the document it
 * touched and the details that were recorded. Older events load on demand.
 * Nothing here can be edited or removed, by anyone. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const PAGE = 100;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const AREAS: Array<{ key: string; label: string; tone: Tone; match: RegExp; hint: string }> = [
  { key: 'money', label: 'Money', tone: 'success', match: /^(invoice|receipt|credit_note|debit_note|vendor_bill|vendor_payment|expense_voucher)\./, hint: 'Invoices, receipts, notes, supplier bills and payments, vouchers' },
  { key: 'sales', label: 'Sales and orders', tone: 'info', match: /^(order|credit_hold|quotation|rate_contract)\./, hint: 'Quotations, rate contracts, orders and credit holds' },
  { key: 'plant', label: 'Stock and plant', tone: 'warning', match: /^(goods_receipt|negative_stock|mix_design|vehicle_maintenance)\./, hint: 'Goods receipts, negative stock, mix designs, maintenance' },
  { key: 'setup', label: 'Masters and settings', tone: 'neutral', match: /^(master|company|setting|tenant)\./, hint: 'Customers, materials, vehicles and the like; company and settings' },
  { key: 'people', label: 'People and access', tone: 'danger', match: /^(user|role|tenant_user)\./, hint: 'Users, roles and permissions' },
  { key: 'corrections', label: 'Corrections', tone: 'info', match: /^document\./, hint: 'Amendments recorded on issued documents' },
];
const areaOf = (action: string) => AREAS.find((a) => a.match.test(action))?.key ?? 'other';
const toneOf = (action: string): Tone => AREAS.find((a) => a.match.test(action))?.tone ?? 'neutral';
/** "credit_hold.release" → "credit hold · release" */
const actionLabel = (action: string) => action.replace(/_/g, ' ').replace('.', ' · ');
const detailLabel = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async (q: string, from: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await auditApi.list({ search: q || undefined, limit: PAGE, offset: from });
      setRows((prev) => (from === 0 ? data : [...prev, ...data]));
      setMore(data.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit trail.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied, offset).finally(() => setLoaded(true));
  }, [applied, offset, load]);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setApplied(search.trim());
  }
  function clearSearch() {
    setSearch('');
    setOffset(0);
    setApplied('');
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(areaOf(r.action), (c.get(areaOf(r.action)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => areaOf(r.action) === filter) : rows;
  const areas = [...AREAS, ...(counts.has('other') ? [{ key: 'other', label: 'Other', tone: 'neutral' as Tone, match: /^$/, hint: 'Everything else' }] : [])];

  return (
    <div className="mn-ord mn-au">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Audit trail</h1>
          <p>A permanent record of the actions that matter: approvals, cancellations, money in and out, and changes to people and settings. Each entry says who did what and when. Entries cannot be edited or removed, by anyone.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ScrollText size={14} aria-hidden />
            {loaded ? `${shown.length} ${shown.length === 1 ? 'event' : 'events'}${more ? ' shown' : ''}${applied ? ` for "${applied}"` : ''}` : 'Loading…'}
          </span>
          <form onSubmit={runSearch} className="mn-rp-search" role="search">
            <Search size={14} aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="A name, an invoice number, or a word like cancelled" aria-label="Search the audit trail" />
            <Button type="submit" variant="secondary" size="sm">Search</Button>
            {applied && <Button type="button" variant="ghost" size="sm" icon={<X size={14} />} onClick={clearSearch}>Clear</Button>}
          </form>
          <Link href="/app/corrections" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<PenLine size={14} />}>Corrections</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => { setOffset(0); load(applied, 0); }} loading={loading && loaded}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Area strip — events per area on screen; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by area">
        {areas.map((a) => {
          const c = counts.get(a.key) ?? 0;
          const on = filter === a.key;
          return (
            <button key={a.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`} data-tone={a.tone} aria-pressed={on} title={a.hint} onClick={() => setFilter(on ? '' : a.key)}>
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{a.label}</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
      </div>

      {error && <ErrorState message={error} />}

      <Card
        title={<span className="mn-board-card-title"><ScrollText size={16} aria-hidden /> Events <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Newest first, {PAGE} at a time. The area chips count the events loaded so far.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={3} /></div>
        ) : shown.length ? (
          <>
            <div className="mn-ord-list" role="list">
              <div className="mn-ord-cols mn-au-cols" aria-hidden>
                <span>When</span>
                <span>Who</span>
                <span>What happened</span>
              </div>
              {shown.map((r) => {
                const details = r.details && typeof r.details === 'object' ? Object.entries(r.details).filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object') : [];
                return (
                  <div key={r.id} className="mn-ord-row mn-au-row" data-tone={toneOf(r.action)} role="listitem">
                    <div className="mn-ord-id">
                      <span className="mn-ord-no">{formatDateTime(r.at)}</span>
                      <span className="mn-ord-meta">{actionLabel(r.action)}</span>
                    </div>
                    <div className="mn-ord-who">
                      <span className="mn-ord-cust">{r.actor}</span>
                      <span className="mn-ord-meta">{r.actorEmail ?? ''}</span>
                    </div>
                    <div className="mn-au-what">
                      <span className="mn-au-summary">{r.summary}</span>
                      <span className="mn-au-meta">
                        {r.entityLabel ? <Badge tone="neutral">{r.entityType ? `${String(r.entityType).replace(/_/g, ' ')} ` : ''}{r.entityLabel}</Badge> : null}
                        {details.slice(0, 4).map(([k, v]) => <span key={k} className="mn-ord-meta mn-au-detail"><span className="mn-au-detail-k">{detailLabel(k)}</span> {String(v)}</span>)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {more && (
              <div className="mn-au-more">
                <Button variant="ghost" loading={loading} onClick={() => setOffset(offset + PAGE)}>Load older events</Button>
              </div>
            )}
          </>
        ) : loading ? (
          <div className="mn-ord-skel"><TableSkeleton cols={3} /></div>
        ) : (
          <EmptyState
            title={filter ? 'Nothing in this area' : applied ? 'No matching events' : 'Nothing recorded yet'}
            description={filter ? 'Press the chip again to see every area, or load older events.' : applied ? 'Try a different search: a name, an invoice number, or a word like "cancelled".' : 'Approvals, cancellations and account changes will appear here as they happen.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button> : applied ? <Button variant="secondary" size="sm" onClick={clearSearch}>Clear the search</Button> : undefined}
          />
        )}
      </Card>
    </div>
  );
}
