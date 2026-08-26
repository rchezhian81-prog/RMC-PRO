'use client';

import { useEffect, useState } from 'react';
import { crud, billingReportsApi, type CustomerStatement, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Field, Input } from '../../../../components/ui/Field';
import { Button } from '../../../../components/ui/Button';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function CustomerStatementPage() {
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [stmt, setStmt] = useState<CustomerStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    crud('customers').list().then(setCustomers).catch((e) => setError(String(e)));
  }, []);

  async function load(cid = customerId, from = range.from, to = range.to) {
    if (!cid) { setStmt(null); return; }
    setError(null);
    setLoading(true);
    try {
      setStmt(await billingReportsApi.customerStatement(cid, from || undefined, to || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load statement');
      setStmt(null);
    } finally {
      setLoading(false);
    }
  }

  function pick(cid: string) {
    setCustomerId(cid);
    load(cid, range.from, range.to);
  }

  // Flatten to CSV rows with the opening line first, so the export mirrors the table.
  const exportRows = stmt
    ? [
        { date: '', particulars: 'Opening balance', ref: '', debit: '', credit: '', balance: stmt.opening },
        ...stmt.rows.map((r) => ({
          date: r.date ?? '', particulars: r.particulars, ref: r.ref,
          debit: r.debit || '', credit: r.credit || '', balance: r.balance,
        })),
      ]
    : [];

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Customer Statement</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>
        Party ledger — opening balance, then invoices (debit) and receipts (credit) in date order with a running balance.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <div style={{ marginBottom: 18 }}>
        <Card title="Statement of account">
          <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 220 }}>
              <Field label="Customer">
                <select className="mn-input" value={customerId} onChange={(e) => pick(e.target.value)}>
                  <option value="">— select —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
            </div>
            <Button variant="secondary" onClick={() => load()} disabled={!customerId}>Apply dates</Button>
          </div>
        </Card>
      </div>

      {stmt && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
          <StatCard label="Opening balance" value={money(stmt.opening)} />
          <StatCard label="Debits (invoices)" value={money(stmt.totalDebit)} tone="warning" />
          <StatCard label="Credits (receipts)" value={money(stmt.totalCredit)} tone="success" />
          <StatCard label="Closing balance" value={money(stmt.closing)} tone={Number(stmt.closing) > 0 ? 'info' : 'neutral'} />
        </div>
      )}

      <Card
        title={stmt ? `Ledger — ${stmt.customerName}` : 'Ledger'}
        padded={false}
        actions={stmt && stmt.rows.length ? <ExportButton rows={exportRows} columns={['date', 'particulars', 'ref', 'debit', 'credit', 'balance']} filename="customer-statement" /> : null}
      >
        {loading ? (
          <TableSkeleton cols={6} />
        ) : !customerId ? (
          <EmptyState title="Pick a customer" description="Select a customer to view their statement of account." />
        ) : stmt && (stmt.rows.length || stmt.opening) ? (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Particulars</Th>
                <Th>Ref</Th>
                <Th numeric>Debit</Th>
                <Th numeric>Credit</Th>
                <Th numeric>Balance</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td />
                <Td style={{ fontWeight: 600 }}>Opening balance</Td>
                <Td /><Td /><Td />
                <Td numeric style={{ fontWeight: 600 }}>{money(stmt.opening)}</Td>
              </tr>
              {stmt.rows.map((r, i) => (
                <tr key={i}>
                  <Td>{r.date ?? ''}</Td>
                  <Td>{r.particulars}</Td>
                  <Td>{r.ref}</Td>
                  <Td numeric>{r.debit ? money(r.debit) : ''}</Td>
                  <Td numeric>{r.credit ? money(r.credit) : ''}</Td>
                  <Td numeric>{money(r.balance)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td style={{ fontWeight: 700 }}>Closing</Td>
                <Td /><Td />
                <Td numeric style={{ fontWeight: 700 }}>{money(stmt.totalDebit)}</Td>
                <Td numeric style={{ fontWeight: 700 }}>{money(stmt.totalCredit)}</Td>
                <Td numeric style={{ fontWeight: 700 }}>{money(stmt.closing)}</Td>
              </tr>
            </tfoot>
          </Table>
        ) : (
          <EmptyState title="No transactions" description="This customer has no invoices or receipts in the selected period." />
        )}
      </Card>
    </div>
  );
}
