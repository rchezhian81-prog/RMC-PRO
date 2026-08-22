'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, Share2 } from 'lucide-react';
import { crud, orderDraftsApi, openQuotationPdf, quotationsApi, type Row } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Form } from '../../../../../components/ui/Form';
import { Field, Input } from '../../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

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
    <div style={{ minWidth: 96 }}>
      <Field label={label}>
        <Input type="number" step="any" inputMode="decimal" value={v} onChange={(e) => on(e.target.value)} />
      </Field>
    </div>
  );
}

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { prompt } = useConfirm();
  const [q, setQ] = useState<Row | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [revs, setRevs] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  const EMPTY_ITEM = { gradeId: '', gradeLabel: '', estimatedQuantity: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '', gstRate: '18' };
  const [item, setItem] = useState(EMPTY_ITEM);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [header, setHeader] = useState({ customerId: '', siteId: '', validUntil: '', paymentTerms: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [full, g, r, c, s] = await Promise.all([
      quotationsApi.get(id), crud('concrete-grades').list(), quotationsApi.revisions(id),
      crud('customers').list(), crud('sites').list(),
    ]);
    setQ(full);
    setGrades(g);
    setRevs(r);
    setCustomers(c);
    setSites(s);
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
    try {
      await fn();
      await load();
      if (okMsg) setMsg(okMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
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
    });
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
  const status = String(q.approvalStatus);
  const locked = status === 'approved';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/app/sales/quotations')}>
          Quotations
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{String(q.quotationNo)}</h1>
        <StatusBadge status={status} />
        <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>rev {String(q.revisionNo)}</span>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <div style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}

      <Card title="Actions">
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 12px' }}>
          {status === 'draft' && 'Add your grade items below, then click Submit to send this for approval.'}
          {status === 'submitted' && 'Waiting for approval — click Approve to accept it (or Reject).'}
          {status === 'approved' && 'Approved and locked. Click Convert → Order draft to turn it into an order.'}
          {status === 'rejected' && 'This was rejected. Make changes, then Re-submit.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {status === 'draft' && <Button onClick={() => run(() => quotationsApi.submit(id), 'Submitted for approval')}>Submit</Button>}
          {status === 'rejected' && <Button onClick={() => run(() => quotationsApi.submit(id), 'Re-submitted')}>Re-submit</Button>}
          {status === 'submitted' && <Button onClick={() => run(() => quotationsApi.approve(id), 'Approved')}>Approve</Button>}
          {status === 'submitted' && <Button variant="secondary" onClick={() => run(() => quotationsApi.reject(id, 'Not accepted'), 'Rejected')}>Reject</Button>}
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => openQuotationPdf(id).catch((e) => setError(String(e)))}>Download PDF</Button>
          <Button variant="secondary" icon={<Share2 size={16} />} onClick={() => run(async () => { const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile (WhatsApp)', defaultValue: '' }); if (m !== null) await quotationsApi.share(id, m); }, 'WhatsApp message logged')}>Share on WhatsApp</Button>
          <Button variant="secondary" onClick={() => run(async () => { const reason = await prompt({ title: 'New revision', label: 'Revision reason', defaultValue: '' }); if (reason !== null) await quotationsApi.createRevision(id, reason); }, 'New revision created')}>New revision</Button>
          {status === 'approved' && (
            <Button onClick={() => run(async () => { const od = await orderDraftsApi.fromQuotation(id, {}); setMsg(`Order draft ${String(od.orderNo)} created`); })}>Convert → Order draft</Button>
          )}
        </div>
      </Card>

      {!locked && (
        <Card title="Details">
          <Form onSubmit={saveHeader} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Customer">
                <select className="mn-input" value={header.customerId} onChange={(e) => setHeader({ ...header, customerId: e.target.value })}>
                  <option value="">— select —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 180 }}>
              <Field label="Site">
                <select className="mn-input" value={header.siteId} onChange={(e) => setHeader({ ...header, siteId: e.target.value })}>
                  <option value="">— select —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={String(s.id)}>{String(s.siteName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Valid until">
                <Input type="date" value={header.validUntil} onChange={(e) => setHeader({ ...header, validUntil: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Payment terms">
                <Input value={header.paymentTerms} onChange={(e) => setHeader({ ...header, paymentTerms: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit" variant="secondary">Save details</Button>
            </div>
          </Form>
        </Card>
      )}

      <Card title="Grade-wise items" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Grade</Th>
              <Th numeric>Qty (m³)</Th>
              <Th numeric>Rate/m³</Th>
              <Th numeric>Transport</Th>
              <Th numeric>Pump</Th>
              <Th numeric>Waiting</Th>
              <Th>GST</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <Td>{String(it.gradeLabel ?? '')}</Td>
                <Td numeric>{money(it.estimatedQuantity)}</Td>
                <Td numeric>{money(it.ratePerM3)}</Td>
                <Td numeric>{money(it.transportCharge)}</Td>
                <Td numeric>{money(it.pumpCharge)}</Td>
                <Td numeric>{money(it.waitingCharge)}</Td>
                <Td numeric>{it.gstApplicable === false ? '—' : `${money(it.gstRate)}%`}</Td>
                <Td style={{ textAlign: 'right' }}>
                  {!locked && (
                    <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button variant="ghost" size="sm" onClick={() => startEditItem(it)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => run(() => quotationsApi.deleteItem(id, String(it.id)))}>Remove</Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <Td colSpan={8} style={{ color: 'var(--mn-muted)' }}>No items yet.</Td>
              </tr>
            )}
          </tbody>
        </Table>
        {!locked ? (
          <>
          <p style={{ color: 'var(--mn-subtle)', fontSize: 12, margin: '12px 16px 0', lineHeight: 1.6 }}>
            All amounts are <strong>per m³</strong>. <strong>Rate</strong> = price of the concrete ·{' '}
            <strong>Transport</strong> = delivery to the site · <strong>Pump</strong> = concrete pumping charge ·{' '}
            <strong>Waiting</strong> = charge for a truck kept waiting at the site. Leave a charge at 0 if it does not apply.
          </p>
          <Form onSubmit={submitItem} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', margin: 16 }}>
            <div style={{ minWidth: 130 }}>
              <Field label="Grade">
                <select className="mn-input" value={item.gradeId} onChange={(e) => setItem({ ...item, gradeId: e.target.value })}>
                  <option value="">— pick —</option>
                  {grades.map((g) => (
                    <option key={g.id} value={String(g.id)}>{String(g.gradeCode)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Num label="Qty m³" v={item.estimatedQuantity} on={(v) => setItem({ ...item, estimatedQuantity: v })} />
            <Num label="Rate/m³" v={item.ratePerM3} on={(v) => setItem({ ...item, ratePerM3: v })} />
            <Num label="Transport" v={item.transportCharge} on={(v) => setItem({ ...item, transportCharge: v })} />
            <Num label="Pump" v={item.pumpCharge} on={(v) => setItem({ ...item, pumpCharge: v })} />
            <Num label="Waiting" v={item.waitingCharge} on={(v) => setItem({ ...item, waitingCharge: v })} />
            <Num label="GST %" v={item.gstRate} on={(v) => setItem({ ...item, gstRate: v })} />
            <div style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
              <Button type="submit" variant="secondary">{editingItemId ? 'Update line' : 'Add item'}</Button>
              {editingItemId && (
                <Button type="button" variant="ghost" onClick={cancelEditItem}>Cancel</Button>
              )}
            </div>
          </Form>
          </>
        ) : (
          <p style={{ color: 'var(--mn-muted)', fontSize: 12, margin: 16 }}>Approved quotation is locked. Create a revision to edit.</p>
        )}
      </Card>

      {(() => {
        const s = q.taxSummary as Row | undefined;
        if (!s) return null;
        // Label yields (ellipsis) when the row is tight so the ₹ value is never
        // clipped on narrow phones; space-between keeps them apart on wide cards.
        const row = (label: string, value: unknown, strong = false) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '3px 0', fontWeight: strong ? 700 : 400, color: strong ? 'inherit' : 'var(--mn-muted)' }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            <span style={{ whiteSpace: 'nowrap' }}>₹{money(value)}</span>
          </div>
        );
        return (
          <Card style={{ maxWidth: 380, marginLeft: 'auto', width: '100%' }}>
            {row('Taxable', s.taxable)}
            {Number(s.cgst) > 0 && row('CGST', s.cgst)}
            {Number(s.cgst) > 0 && row('SGST', s.sgst)}
            {Number(s.igst) > 0 && row('IGST', s.igst)}
            <div style={{ borderTop: '1px solid var(--mn-border)', margin: '8px 0', paddingTop: 8 }}>
              {row(`Total${s.isInterstate ? ' (inter-state)' : ''}`, s.total, true)}
            </div>
          </Card>
        );
      })()}

      <Card title="Revision history" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th numeric>Rev</Th>
              <Th>Reason</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {revs.map((r) => (
              <tr key={r.id}>
                <Td numeric>{String(r.revisionNo)}</Td>
                <Td>{String(r.changeReason ?? '—')}</Td>
                <Td>{String(r.createdAt ?? '').slice(0, 19).replace('T', ' ')}</Td>
              </tr>
            ))}
            {!revs.length && (
              <tr>
                <Td colSpan={3} style={{ color: 'var(--mn-muted)' }}>No revisions.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
