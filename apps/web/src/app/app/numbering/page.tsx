'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, Hash, ListOrdered, MonitorSmartphone, Plus, RefreshCw, X } from 'lucide-react';
import { formatDate } from '../../../lib/format-date';
import { crud, numberingApi, type Row } from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input, Select } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * Document numbering — blocks of numbers set aside for a manual book or an
 * offline plant.
 *
 * A document strip with live counts doubles as the filter, a pill counts
 * the blocks, and each block is one row: the document with the run of
 * numbers and the financial year; the plant (or company-wide) and the
 * device that holds it; how much of it is used, on a bar; when unused
 * numbers return; the status. The reserve form opens on demand and says
 * what a block is for. Same layout in both skins; every colour reads the
 * semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const DOC_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'delivery_challan', label: 'Delivery challan', hint: 'The paper that travels with the truck' },
  { value: 'invoice', label: 'Invoice', hint: 'Tax invoices; keep the run unbroken for GST' },
  { value: 'receipt', label: 'Receipt', hint: 'Money received from a customer' },
  { value: 'order', label: 'Order', hint: 'Customer orders' },
  { value: 'quotation', label: 'Quotation', hint: 'Offers to customers' },
  { value: 'dispatch', label: 'Dispatch', hint: 'Truck loads sent out' },
];
const docLabel = (v: unknown) => DOC_TYPES.find((t) => t.value === String(v))?.label ?? String(v ?? '').replace(/_/g, ' ');

export default function NumberingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [documentType, setDocumentType] = useState('delivery_challan');
  const [count, setCount] = useState('25');
  const [plantId, setPlantId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = getAccess().has('sync.manage');

  const reload = useCallback(async () => {
    const [r, p] = await Promise.all([numberingApi.reservations(), crud('plants').list()]);
    setRows(r);
    setPlants(p);
  }, []);
  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

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

  async function reserve(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (!(num(count) > 0)) { setError('Say how many numbers to set aside.'); return; }
    setBusy(true);
    try {
      const res = await numberingApi.reserve({ documentType, count: num(count), plantId: plantId || undefined });
      setMsg(`${String(res.sampleFrom)} to ${String(res.sampleTo)} set aside for ${docLabel(res.documentType).toLowerCase()}s${res.financialYear ? ` (FY ${String(res.financialYear)})` : ''}. The app skips them; write them in the book in order.`);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const plantName = (id: unknown) => String(plants.find((p) => String(p.id) === String(id))?.plantName ?? 'Plant');
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(String(r.documentType), (c.get(String(r.documentType)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => String(r.documentType) === filter) : rows;
  const kinds = [...new Set([...DOC_TYPES.map((t) => t.value).filter((k) => counts.has(k)), ...counts.keys()])];
  const active = rows.filter((r) => String(r.status) === 'active').length;

  return (
    <div className="mn-ord mn-nm">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Document numbering</h1>
          <p>A block sets aside a run of document numbers that the app will not use: for a manual challan book kept at the plant, or for a PC that works offline. Numbers reset each financial year, and a plant draws from its own series. The devices that sync take their own blocks under <Link href="/app/devices" className="mn-id-link">Devices and sync</Link>.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ListOrdered size={14} aria-hidden />
            {loaded ? `${shown.length} ${shown.length === 1 ? 'block' : 'blocks'}${!filter && rows.length ? ` · ${active} active` : ''}` : 'Loading…'}
          </span>
          {canManage && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>Set aside a block</Button>}
          <Link href="/app/devices" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<MonitorSmartphone size={14} />}>Devices and sync</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {kinds.length > 0 && (
        <div className="mn-board-strip" role="group" aria-label="Filter by document">
          {kinds.map((k) => {
            const c = counts.get(k) ?? 0;
            const on = filter === k;
            return (
              <button key={k} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`} data-tone="info" aria-pressed={on} onClick={() => setFilter(on ? '' : k)}>
                <span className="mn-board-chip-n">{c}</span>
                <span className="mn-board-chip-l">{docLabel(k)}s</span>
              </button>
            );
          })}
          {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canManage && (
        <Card
          title={<span className="mn-board-card-title"><Hash size={16} aria-hidden /> Set aside a block of numbers</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={reserve} className="mn-nm-form">
            <Field label="Document" help={DOC_TYPES.find((t) => t.value === documentType)?.hint}>
              <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="How many" required help="One book is usually 25, 50 or 100 leaves.">
              <Input type="number" inputMode="numeric" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} required />
            </Field>
            <Field label="Plant" help="Each plant has its own series; leave it blank for the company-wide one.">
              <Select value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                <option value="">Company-wide</option>
                {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
              </Select>
            </Field>
            <div className="mn-nm-form-submit">
              <Button type="submit" loading={busy} icon={<Hash size={14} />}>Set aside {num(count) || ''} {num(count) === 1 ? 'number' : 'numbers'}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">The next numbers in the series are taken; the app carries on after them. Unused ones come back when the block expires.</span>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Hash size={16} aria-hidden /> Blocks <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Newest first. A block with a device was taken by that device on its own.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-nm-cols" aria-hidden>
              <span>Numbers</span>
              <span>For</span>
              <span>Used</span>
              <span>Expires</span>
              <span>Status</span>
            </div>
            {shown.map((r) => {
              const size = num(r.numberTo) - num(r.numberFrom) + 1;
              const used = num(r.usedCount);
              const pad = num(r.paddingLength) || 4;
              const fmt = (n: number) => `${String(r.prefix ?? '')}${String(n).padStart(pad, '0')}`;
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-nm-row${String(r.status) === 'active' ? '' : ' is-void'}`} data-tone={String(r.status) === 'active' ? 'info' : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{fmt(num(r.numberFrom))} to {fmt(num(r.numberTo))}</span>
                    <span className="mn-ord-meta">{docLabel(r.documentType)}{r.financialYear ? ` · FY ${String(r.financialYear)}` : ''} · {size} {size === 1 ? 'number' : 'numbers'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{r.plantId ? plantName(r.plantId) : 'Company-wide'}</span>
                    <span className="mn-ord-meta">{r.deviceName ? `held by ${String(r.deviceName)}` : 'a manual book'} · {formatDate(r.createdAt)}</span>
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
          <EmptyState
            title={filter ? `No ${docLabel(filter).toLowerCase()} blocks` : 'No blocks set aside'}
            description={filter ? 'Press the chip again to see every document.' : canManage ? 'Press Set aside a block when a plant keeps a manual challan book or a PC will work offline for a while.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button> : canManage ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>Set aside a block</Button> : undefined}
          />
        )}
      </Card>
    </div>
  );
}
