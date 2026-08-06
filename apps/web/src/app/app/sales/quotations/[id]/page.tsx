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

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [q, setQ] = useState<Row | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [revs, setRevs] = useState<Row[]>([]);
  const [item, setItem] = useState({ gradeId: '', gradeLabel: '', estimatedQuantity: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [full, g, r] = await Promise.all([quotationsApi.get(id), crud('concrete-grades').list(), quotationsApi.revisions(id)]);
    setQ(full);
    setGrades(g);
    setRevs(r);
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

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const g = grades.find((x) => String(x.id) === item.gradeId);
    await run(async () => {
      await quotationsApi.addItem(id, {
        gradeId: item.gradeId || undefined,
        gradeLabel: item.gradeLabel || (g ? String(g.gradeCode) : ''),
        estimatedQuantity: Number(item.estimatedQuantity || 0),
        ratePerM3: Number(item.ratePerM3 || 0),
        transportCharge: Number(item.transportCharge || 0),
        pumpCharge: Number(item.pumpCharge || 0),
        waitingCharge: Number(item.waitingCharge || 0),
      });
      setItem({ gradeId: '', gradeLabel: '', estimatedQuantity: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
    });
  }

  if (!q) return <Loading label="Loading quotation…" />;
  const items = (q.items as Row[]) ?? [];
  const status = String(q.approvalStatus);
  const locked = status === 'approved';
  const Num = ({ label, v, on }: { label: string; v: string; on: (v: string) => void }) => (
    <div style={{ minWidth: 96 }}>
      <Field label={label}>
        <Input type="number" step="any" value={v} onChange={(e) => on(e.target.value)} />
      </Field>
    </div>
  );

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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {status === 'draft' && <Button onClick={() => run(() => quotationsApi.submit(id), 'Submitted for approval')}>Submit</Button>}
          {status === 'rejected' && <Button onClick={() => run(() => quotationsApi.submit(id), 'Re-submitted')}>Re-submit</Button>}
          {status === 'submitted' && <Button onClick={() => run(() => quotationsApi.approve(id), 'Approved')}>Approve</Button>}
          {status === 'submitted' && <Button variant="secondary" onClick={() => run(() => quotationsApi.reject(id, 'Not accepted'), 'Rejected')}>Reject</Button>}
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => openQuotationPdf(id).catch((e) => setError(String(e)))}>Download PDF</Button>
          <Button variant="secondary" icon={<Share2 size={16} />} onClick={() => run(async () => { const m = window.prompt('Recipient mobile (WhatsApp)', ''); if (m !== null) await quotationsApi.share(id, m); }, 'WhatsApp message logged')}>Share on WhatsApp</Button>
          <Button variant="secondary" onClick={() => run(async () => { const reason = window.prompt('Revision reason', ''); if (reason !== null) await quotationsApi.createRevision(id, reason); }, 'New revision created')}>New revision</Button>
          {status === 'approved' && (
            <Button onClick={() => run(async () => { const od = await orderDraftsApi.fromQuotation(id, {}); setMsg(`Order draft ${String(od.orderNo)} created`); })}>Convert → Order draft</Button>
          )}
        </div>
      </Card>

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
                <Td>{it.gstApplicable ? 'Yes' : 'No'}</Td>
                <Td style={{ textAlign: 'right' }}>
                  {!locked && (
                    <Button variant="ghost" size="sm" onClick={() => run(() => quotationsApi.deleteItem(id, String(it.id)))}>Remove</Button>
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
          <Form onSubmit={addItem} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', margin: 16 }}>
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
            <div style={{ marginBottom: 14 }}>
              <Button type="submit" variant="secondary">Add item</Button>
            </div>
          </Form>
        ) : (
          <p style={{ color: 'var(--mn-muted)', fontSize: 12, margin: 16 }}>Approved quotation is locked. Create a revision to edit.</p>
        )}
      </Card>

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
