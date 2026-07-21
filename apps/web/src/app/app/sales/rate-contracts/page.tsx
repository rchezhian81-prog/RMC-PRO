'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { crud, rateContractsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

export default function RateContractsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [form, setForm] = useState({ customerId: '', validFrom: '', validTo: '', paymentTerms: '', transportTerms: '' });
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [rc, c] = await Promise.all([rateContractsApi.list(), crud('customers').list()]);
    setRows(rc);
    setCustomers(c);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.customerId) delete payload.customerId;
      await rateContractsApi.create(payload);
      setForm({ customerId: '', validFrom: '', validTo: '', paymentTerms: '', transportTerms: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Rate Contracts</h1>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <div style={{ marginBottom: 18 }}>
        <Card title="New rate contract">
          <form onSubmit={create} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
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
            <div style={{ minWidth: 150 }}>
              <Field label="Valid from">
                <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Valid to">
                <Input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Payment terms">
                <Input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Rate contracts" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Contract No</Th>
                <Th>Valid from</Th>
                <Th>Valid to</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.rateContractNo ?? '')}</Td>
                  <Td>{String(r.validFrom ?? '—')}</Td>
                  <Td>{String(r.validTo ?? '—')}</Td>
                  <Td><StatusBadge status={String(r.approvalStatus)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Link href={`/app/sales/rate-contracts/${r.id}`}>
                      <Button variant="secondary" size="sm">Open</Button>
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No rate contracts yet" description="Create your first rate contract above." />
        )}
      </Card>
    </div>
  );
}
