'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardList, Download, FileText, History, Hourglass, MapPin, Plus, RefreshCw, Send, Share2, XCircle } from 'lucide-react';
import { crud, orderDraftsApi, openPdf, quotationsApi, type Row, openWhatsAppShare } from '../../../../../lib/api';
import { money } from '../../../../../lib/money';
import { formatDate, formatDateTime } from '../../../../../lib/format-date';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { StatCard } from '../../../../../components/ui/StatCard';
import { Form } from '../../../../../components/ui/Form';
import { Field, Input } from '../../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { AlertSurface } from '../../../../../components/ui/AlertSurface';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';
import { todayLocal } from '../../../../../lib/report-range';

/**
 * Quotation detail — one quotation from draft to order.
 *
 * The header says who it is for, where, how long it stays valid and the
 * terms; the stage's own action (submit, approve / reject, convert) sits
 * beside Print / PDF, WhatsApp and New revision. Four tiles carry the money
 * and volume. Below, two columns: the grade lines with the add / edit form
 * and the revision history on the left; the money (tax summary) and the
 * editable details on the right. Same layout in both skins.
 */

const money2 = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

/** Common payment terms for an Indian RMC plant — a picklist beats free text. */
const PAYMENT_TERMS = ['Advance (100%)', 'Cash on delivery', 'Credit — 15 days', 'Credit — 30 days', 'Credit — 45 days', 'UPI', 'NEFT / RTGS', 'Cheque'];

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * A number field. Defined at module scope, NOT inside the page component.
 *
 * A component declared inside another component is a brand-new type on every
 * render — and this page re-renders on every keystroke — so React unmounts the
 * old <input> and mounts a fresh one each time, and the field loses focus after
 * a single digit. Hoisting it here keeps the same input element across renders,
 * so you can type a whole number without re-clicking.
 */
function Num({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <Field label={label}>
      <Input type="number" step="any" inputMode="decimal" value={v} onChange={(e) => on(e.target.value)} />
    </Field>
  );
}

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>();
  const { prompt } = useConfirm();
  const [q, setQ] = useState<Row | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [revs, setRevs] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const EMPTY_ITEM = { gradeId: '', gradeLabel: '', estimatedQuantity: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '', gstRate: '18' };
  const [item, setItem] = useState(EMPTY_ITEM);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [header, setHeader] = useState({ customerId: '', siteId: '', validUntil: '', paymentTerms: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [full, g, r, c, s, p] = await Promise.all([
      quotationsApi.get(id), crud('concrete-grades').list(), quotationsApi.revisions(id),
      crud('customers').list(), crud('sites').list(), crud('plants').list(),
    ]);
    setQ(full);
    setGrades(g);
    setRevs(r);
    setCustomers(c);
    setSites(s);
    setPlants(p);
    setHeader({
      customerId: String(full.customerId ?? ''), siteId: String(full.siteId ?? ''),
      validUntil: String(full.validUntil ?? '').slice(0, 10), paymentTerms: String(full.paymentTerms ?? ''),
    });
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      // An action may return the sentence to show (a share says where the
      // message went); a fixed okMsg still wins when the caller gives one.
      const out = await fn();
      await load();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitItem(e: FormEvent) {
    e.preventDefault();
    const g = grades.find((x) => String(x.id) === item.gradeId);
    const body = {
      gradeId: item.gradeId || undefined,
      gradeLabel: item.gradeLabel || (g ? String(g.gradeCode) : ''),
      estimatedQuantity: Number(item.estimatedQuantity || 0),
      ratePerM3: Number(item.ratePerM3 || 0),
      transportCharge: Number(item.transportCharge || 0),
      pumpCharge: Number(item.pumpCharge || 0),
      waitingCharge: Number(item.waitingCharge || 0),
      gstRate: Number(item.gstRate || 0),
    };
    await run(async () => {
      if (editingItemId) await quotationsApi.updateItem(id, editingItemId, body);
      else await quotationsApi.addItem(id, body);
      setItem(EMPTY_ITEM);
      setEditingItemId(null);
    }, editingItemId ? 'Line updated' : 'Grade item added');
  }
  function startEditItem(it: Row) {
    setEditingItemId(String(it.id));
    setItem({
      gradeId: String(it.gradeId ?? ''), gradeLabel: String(it.gradeLabel ?? ''),
      estimatedQuantity: String(it.estimatedQuantity ?? ''), ratePerM3: String(it.ratePerM3 ?? ''),
      transportCharge: String(it.transportCharge ?? ''), pumpCharge: String(it.pumpCharge ?? ''),
      waitingCharge: String(it.waitingCharge ?? ''), gstRate: String(it.gstRate ?? '18'),
    });
  }
  function cancelEditItem() {
    setEditingItemId(null);
    setItem(EMPTY_ITEM);
  }
  async function saveHeader(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await quotationsApi.update(id, {
        customerId: header.customerId || undefined,
        siteId: header.siteId || undefined,
        validUntil: header.validUntil || undefined,
        paymentTerms: header.paymentTerms || undefined,
      });
    }, 'Details updated');
  }

  if (!q) return error ? <ErrorState message={error} /> : <Loading label="Loading quotation…" />;
  const items = (q.items as Row[]) ?? [];
  const tax = q.taxSummary as Row | undefined;
  const status = String(q.approvalStatus);
  const converted = String(q.status) === 'converted';
  const locked = status === 'approved';
  const rev = num(q.revisionNo);
  const lineAllIn = (it: Row) => num(it.ratePerM3) + num(it.transportCharge) + num(it.pumpCharge) + num(it.waitingCharge);
  const lineTotal = (it: Row) => num(it.estimatedQuantity) * lineAllIn(it);
  const totalM3 = items.reduce((t, it) => t + num(it.estimatedQuantity), 0);
  const quoted = items.reduce((t, it) => t + lineTotal(it), 0);
  const validRaw = String(q.validUntil ?? '').slice(0, 10);
  const days = /^\d{4}-\d{2}-\d{2}$/.test(validRaw) ? daysUntil(validRaw) : null;
  const validity = converted ? { label: 'Converted to an order', tone: 'success' as const }
    : days == null ? { label: 'No expiry set', tone: 'neutral' as const }
    : days < 0 ? { label: days === -1 ? 'Expired yesterday' : `Expired ${-days} days ago`, tone: 'danger' as const }
    : days === 0 ? { label: 'Expires today', tone: 'warning' as const }
    : days <= 7 ? { label: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'warning' as const }
    : { label: `${days} days left`, tone: 'neutral' as const };
  // Sites narrow to the chosen customer, so a site cannot be picked for the wrong customer.
  const siteOptions = header.customerId ? sites.filter((s) => String(s.customerId ?? '') === header.customerId) : sites;
  const termOptions = q.paymentTerms && !PAYMENT_TERMS.includes(String(q.paymentTerms)) ? [String(q.paymentTerms), ...PAYMENT_TERMS] : PAYMENT_TERMS;

  const convert = () => run(async () => {
    const plantId = await prompt({
      title: 'Convert → Order draft',
      label: 'Producing plant',
      message: 'Assign the order to a plant (used for scheduling and batching). The order date is set to today.',
      options: plants.map((p) => ({ value: String(p.id), label: String(p.plantName ?? p.plantCode ?? p.id) })),
      defaultValue: plants[0] ? String(plants[0].id) : '',
      confirmLabel: 'Create order draft',
    });
    if (plantId === null) return;
    const od = await orderDraftsApi.fromQuotation(id, { plantId: plantId || undefined, orderDate: todayLocal() });
    return `Order draft ${String(od.orderNo)} created — find it under Orders.`;
  });

  return (
    <div className="mn-od">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/app/sales/quotations" className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Quotations</Link>
          <h1>
            {String(q.quotationNo)}
            <span className="mn-od-badges">
              <StatusBadge status={status} />
              {converted && <Badge tone="neutral">converted</Badge>}
              {rev > 0 && <Badge tone="info">rev {rev}</Badge>}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who">{String(q.customerName ?? 'Customer not set')}</span>
            {q.siteName ? <span className="mn-od-fact"><MapPin size={13} aria-hidden /> {String(q.siteName)}</span> : null}
            <span className="mn-od-fact"><ClipboardList size={13} aria-hidden /> Quoted {formatDate(q.quotationDate ?? q.createdAt)}</span>
            <span className="mn-od-fact" data-tone={validity.tone}><CalendarClock size={13} aria-hidden /> {q.validUntil ? `Valid till ${formatDate(q.validUntil)}` : 'No expiry'} · <span className="mn-qd-validity">{validity.label}</span></span>
            <span className="mn-od-fact">{q.paymentTerms ? String(q.paymentTerms) : 'Terms not set'} · {String(q.pricingType) === 'credit' ? 'credit pricing' : 'cash pricing'}</span>
          </p>
        </div>
        <div className="mn-board-tools">
          {status === 'draft' && <Button icon={<Send size={14} />} onClick={() => run(() => quotationsApi.submit(id), 'Submitted for approval')} loading={busy} disabled={!items.length}>Submit for approval</Button>}
          {status === 'rejected' && <Button icon={<Send size={14} />} onClick={() => run(() => quotationsApi.submit(id), 'Re-submitted')} loading={busy}>Re-submit</Button>}
          {status === 'submitted' && <Button icon={<CheckCircle2 size={14} />} onClick={() => run(() => quotationsApi.approve(id), 'Approved')} loading={busy}>Approve</Button>}
          {status === 'submitted' && <Button variant="secondary" icon={<XCircle size={14} />} onClick={() => run(async () => { const reason = await prompt({ title: 'Reject quotation', label: 'Rejection reason (why the quote was lost)', defaultValue: '' }); if (reason !== null) await quotationsApi.reject(id, reason || 'Not accepted'); }, 'Quotation rejected')}>Reject</Button>}
          {status === 'approved' && !converted && <Button icon={<FileText size={14} />} onClick={convert} loading={busy}>Convert → Order draft</Button>}
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => openPdf(`/quotations/${id}/pdf`, String(q?.quotationNo ?? '')).catch((e) => setError(String(e)))}>Print / PDF</Button>
          <Button variant="secondary" icon={<Share2 size={16} />} onClick={() => run(async () => { const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile (WhatsApp)', defaultValue: '' }); if (m === null) return 'Not shared.'; return openWhatsAppShare(() => quotationsApi.share(id, m)); })}>Share on WhatsApp</Button>
          <Button variant="ghost" icon={<History size={14} />} onClick={() => run(async () => { const reason = await prompt({ title: 'New revision', label: 'Revision reason', defaultValue: '' }); if (reason !== null) await quotationsApi.createRevision(id, reason); }, 'New revision created — the quotation is a draft again')}>New revision</Button>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => run(async () => undefined)} loading={busy}>Refresh</Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <AlertSurface tone="success">{msg}</AlertSurface>}

      {status === 'draft' && (
        <div className="mn-ord-note" role="status">
          <ClipboardList size={16} aria-hidden />
          <span><strong>Draft.</strong> {items.length ? 'Check the grade lines and the details, then submit it for approval.' : 'Add at least one grade line below, then submit it for approval.'}</span>
        </div>
      )}
      {status === 'submitted' && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Hourglass size={16} aria-hidden />
          <span><strong>Waiting for approval.</strong> Approve to lock the prices, or reject with a reason so the salesperson can revise it.</span>
        </div>
      )}
      {status === 'approved' && !converted && (
        <div className="mn-ord-note mn-ord-note--ok" role="status">
          <CheckCircle2 size={16} aria-hidden />
          <span><strong>Approved and locked.</strong> Convert it into an order draft to book production, or create a revision to change it.</span>
        </div>
      )}
      {converted && (
        <div className="mn-ord-note" role="status">
          <FileText size={16} aria-hidden />
          <span><strong>Converted to an order.</strong> The prices here are frozen; the order carries them. To quote again, create a revision.</span>
        </div>
      )}
      {status === 'rejected' && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <XCircle size={16} aria-hidden />
          <span><strong>Rejected.</strong> {q.remarks ? `${String(q.remarks).replace(/[.\s]+$/, '')}.` : 'No reason recorded.'} Change the lines or the details, then re-submit.</span>
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Quoted value (ex-GST)" value={money(tax?.taxable ?? quoted)} />
        <StatCard label="Total incl. GST" value={money(tax?.total ?? quoted)} tone="info" />
        <StatCard label="Volume" value={`${qty(totalM3)} m³`} />
        <StatCard label="Grades" value={items.length} />
        <StatCard label="Validity" value={days == null ? '—' : days < 0 ? 'Expired' : `${days} d`} tone={validity.tone === 'neutral' ? 'neutral' : validity.tone} />
      </div>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><ClipboardList size={16} aria-hidden /> Grade lines <span className="mn-board-card-count">{items.length}</span></span>} padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Grade</Th>
                  <Th numeric>Qty m³</Th>
                  <Th numeric>Rate/m³</Th>
                  <Th numeric>All-in/m³</Th>
                  <Th>GST</Th>
                  <Th numeric>Line value</Th>
                  {!locked && <Th />}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={String(it.id)} className={editingItemId === String(it.id) ? 'mn-qd-editing' : undefined}>
                    <Td><span className="mn-od-grade">{String(it.gradeLabel ?? '')}</span></Td>
                    <Td numeric className="mn-od-num">{qty(it.estimatedQuantity)}</Td>
                    <Td numeric>
                      <span className="mn-od-num">{money2(it.ratePerM3)}</span>
                      {lineAllIn(it) - num(it.ratePerM3) > 0 && (
                        <span className="mn-od-rate-meta">+ {[num(it.transportCharge) ? `transport ${money2(it.transportCharge)}` : '', num(it.pumpCharge) ? `pump ${money2(it.pumpCharge)}` : '', num(it.waitingCharge) ? `waiting ${money2(it.waitingCharge)}` : ''].filter(Boolean).join(' · ')}</span>
                      )}
                    </Td>
                    <Td numeric className="mn-od-num">{money2(lineAllIn(it))}</Td>
                    <Td>{it.gstApplicable === false ? <span className="mn-ord-meta">exempt</span> : `${num(it.gstRate)}%`}</Td>
                    <Td numeric className="mn-od-num">{money2(lineTotal(it))}</Td>
                    {!locked && (
                      <Td style={{ textAlign: 'right' }}>
                        <span className="mn-cu-acts mn-ord-act" style={{ display: 'inline-flex', gap: 2 }}>
                          <Button variant="ghost" size="sm" onClick={() => startEditItem(it)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => run(() => quotationsApi.deleteItem(id, String(it.id)), 'Line removed')}>Remove</Button>
                        </span>
                      </Td>
                    )}
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <Td colSpan={locked ? 6 : 7} style={{ color: 'var(--mn-muted)' }}>No grade lines yet. Add the first one below.</Td>
                  </tr>
                )}
              </tbody>
            </Table>
            <div className="mn-od-lines-foot">
              <span className="mn-ord-meta">All-in/m³ = rate + transport + pump + waiting. Line value = qty × all-in, before GST.</span>
              <span className="mn-od-lines-total">Quoted <strong>{money2(quoted)}</strong> <span className="mn-ord-meta">ex-GST</span></span>
            </div>
            {!locked ? (
              <div className="mn-qd-item-wrap">
                <p className="mn-board-form-hint" style={{ margin: '0 0 10px' }}>
                  <strong>{editingItemId ? 'Editing a line.' : 'Add a grade line.'}</strong> All amounts are per m³: <strong>Rate</strong> is the concrete, <strong>Transport</strong> the delivery to site, <strong>Pump</strong> the pumping charge, <strong>Waiting</strong> a truck kept waiting. Leave a charge at 0 if it does not apply.
                </p>
                <Form onSubmit={submitItem} className="mn-qd-item-form">
                  <Field label="Grade">
                    <select className="mn-input" value={item.gradeId} onChange={(e) => setItem({ ...item, gradeId: e.target.value })} required>
                      <option value="">— pick —</option>
                      {grades.map((g) => (
                        <option key={String(g.id)} value={String(g.id)}>{String(g.gradeCode)}</option>
                      ))}
                    </select>
                  </Field>
                  <Num label="Qty m³" v={item.estimatedQuantity} on={(v) => setItem({ ...item, estimatedQuantity: v })} />
                  <Num label="Rate/m³" v={item.ratePerM3} on={(v) => setItem({ ...item, ratePerM3: v })} />
                  <Num label="Transport" v={item.transportCharge} on={(v) => setItem({ ...item, transportCharge: v })} />
                  <Num label="Pump" v={item.pumpCharge} on={(v) => setItem({ ...item, pumpCharge: v })} />
                  <Num label="Waiting" v={item.waitingCharge} on={(v) => setItem({ ...item, waitingCharge: v })} />
                  <Num label="GST %" v={item.gstRate} on={(v) => setItem({ ...item, gstRate: v })} />
                  <div className="mn-qd-item-submit">
                    <Button type="submit" variant={editingItemId ? 'primary' : 'secondary'} icon={editingItemId ? undefined : <Plus size={14} />}>{editingItemId ? 'Update line' : 'Add line'}</Button>
                    {editingItemId && <Button type="button" variant="ghost" onClick={cancelEditItem}>Cancel</Button>}
                  </div>
                </Form>
              </div>
            ) : (
              <p className="mn-board-form-hint mn-qd-locked">Approved quotations are locked. Create a revision to change the lines.</p>
            )}
          </Card>

          <Card title={<span className="mn-board-card-title"><History size={16} aria-hidden /> Revision history</span>}>
            {revs.length ? (
              <ol className="mn-od-tl">
                {[...revs].sort((a, b) => num(b.revisionNo) - num(a.revisionNo)).map((r) => (
                  <li key={String(r.id)} data-tone="info">
                    <span className="mn-od-tl-dot" aria-hidden />
                    <div className="mn-od-tl-body">
                      <span className="mn-od-tl-title">Revision {num(r.revisionNo) + 1} raised{r.changeReason ? '' : ' (no reason given)'}</span>
                      <span className="mn-ord-meta">{formatDateTime(r.createdAt)}<span className="mn-ord-dot" aria-hidden>·</span>rev {num(r.revisionNo)} snapshot kept</span>
                      {r.changeReason ? <span className="mn-od-tl-note">{String(r.changeReason)}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mn-board-form-hint" style={{ margin: 0 }}>No revisions yet. A revision snapshots the current lines, bumps the number and reopens the quotation as a draft.</p>
            )}
          </Card>
        </div>

        <aside className="mn-od-side">
          {tax && (
            <Card title="Money">
              <dl className="mn-od-money">
                <div><dt>Taxable value</dt><dd>{money2(tax.taxable)}</dd></div>
                {num(tax.cgst) > 0 && <div><dt>CGST</dt><dd>{money2(tax.cgst)}</dd></div>}
                {num(tax.cgst) > 0 && <div><dt>SGST</dt><dd>{money2(tax.sgst)}</dd></div>}
                {num(tax.igst) > 0 && <div><dt>IGST</dt><dd>{money2(tax.igst)}</dd></div>}
                <div className="mn-od-money-total"><dt>Total{tax.isInterstate ? ' (inter-state)' : ''}</dt><dd>{money2(tax.total)}</dd></div>
              </dl>
              <p className="mn-board-form-hint">{tax.isInterstate ? 'Inter-state supply: IGST applies.' : 'Intra-state supply: CGST + SGST apply.'} Freight is part of the taxable base.</p>
            </Card>
          )}

          <Card title="Details">
            {!locked ? (
              <Form onSubmit={saveHeader} className="mn-qd-details">
                <Field label="Customer">
                  <select className="mn-input" value={header.customerId} onChange={(e) => setHeader({ ...header, customerId: e.target.value, siteId: '' })}>
                    <option value="">— select —</option>
                    {customers.map((c) => (
                      <option key={String(c.id)} value={String(c.id)}>{String(c.customerName)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Site">
                  <select className="mn-input" value={header.siteId} onChange={(e) => setHeader({ ...header, siteId: e.target.value })}>
                    <option value="">— select —</option>
                    {siteOptions.map((s) => (
                      <option key={String(s.id)} value={String(s.id)}>{String(s.siteName)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Valid until">
                  <Input type="date" value={header.validUntil} onChange={(e) => setHeader({ ...header, validUntil: e.target.value })} />
                </Field>
                <Field label="Payment terms">
                  <select className="mn-input" value={header.paymentTerms} onChange={(e) => setHeader({ ...header, paymentTerms: e.target.value })}>
                    <option value="">— select —</option>
                    {termOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <div className="mn-qd-details-submit"><Button type="submit" variant="secondary" loading={busy}>Save details</Button></div>
              </Form>
            ) : (
              <dl className="mn-od-money mn-od-money--tight">
                <div><dt>Customer</dt><dd>{String(q.customerName ?? '—')}</dd></div>
                <div><dt>Site</dt><dd>{String(q.siteName ?? '—')}</dd></div>
                <div><dt>Valid until</dt><dd>{q.validUntil ? formatDate(q.validUntil) : '—'}</dd></div>
                <div><dt>Payment terms</dt><dd>{String(q.paymentTerms ?? '—')}</dd></div>
                <div><dt>Pricing</dt><dd>{String(q.pricingType) === 'credit' ? 'Credit' : 'Cash'}</dd></div>
              </dl>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
