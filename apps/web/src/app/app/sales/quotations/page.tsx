'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { crud, quotationsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/** Common payment terms for an Indian RMC plant — a picklist beats free text. */
const PAYMENT_TERMS = [
  'Advance (100%)',
  'Cash on delivery',
  'Credit — 15 days',
  'Credit — 30 days',
  'Credit — 45 days',
  'UPI',
  'NEFT / RTGS',
  'Cheque',
];

export default function QuotationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  const [form, setForm] = useState({ customerId: '', siteId: '', quotationDate: '', validUntil: '', paymentTerms: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [q, c, s] = await Promise.all([quotationsApi.list(), crud('customers').list(), crud('sites').list()]);
    setRows(q);
    setCustomers(c);
    setSites(s);
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.customerId) delete payload.customerId;
      if (!payload.siteId) delete payload.siteId;
      await quotationsApi.create(payload);
      setForm({ customerId: '', siteId: '', quotationDate: '', validUntil: '', paymentTerms: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Quotations</h1>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <div style={{ marginBottom: 18 }}>
        <Card title="New quotation">
          <Form onSubmit={create} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Customer">
                <select className="mn-input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                  <option value="">— select —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 180 }}>
              <Field label="Site">
                <select className="mn-input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                  <option value="">— select —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={String(s.id)}>{String(s.siteName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Date">
                <Input type="date" value={form.quotationDate} onChange={(e) => setForm({ ...form, quotationDate: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Valid until">
                <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 170 }}>
              <Field label="Payment terms">
                <select className="mn-input" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
                  <option value="">— select —</option>
                  {PAYMENT_TERMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </Form>
        </Card>
      </div>

      <Card title="Quotations" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Quotation No</Th>
                <Th>Date</Th>
                <Th>Valid until</Th>
                <Th numeric>Rev</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.quotationNo ?? '')}</Td>
                  <Td>{String(r.quotationDate ?? '—')}</Td>
                  <Td>{String(r.validUntil ?? '—')}</Td>
                  <Td numeric>{String(r.revisionNo ?? 0)}</Td>
                  <Td><StatusBadge status={String(r.approvalStatus)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Link href={`/app/sales/quotations/${r.id}`}>
                      <Button variant="secondary" size="sm">Open</Button>
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No quotations yet" description="Create your first quotation above." />
        )}
      </Card>
    </div>
  );
}
