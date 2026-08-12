'use client';

import { useEffect, useState } from 'react';
import { crud, expensesApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const PAYMENT_MODES = ['cash', 'bank', 'upi', 'cheque'];
const ALLOC_TYPES = ['general', 'plant', 'vehicle', 'site'];

interface LineDraft { expenseHeadId: string; description: string; amount: string; allocationType: string; allocationId: string }
const emptyLine = (): LineDraft => ({ expenseHeadId: '', description: '', amount: '', allocationType: 'general', allocationId: '' });

interface Bucket { key: string; label: string; amount: number; share: number }

export default function ExpenseVouchersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [heads, setHeads] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  const [report, setReport] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [payee, setPayee] = useState('');
  const [mode, setMode] = useState('cash');
  const [plantId, setPlantId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const canManage = getAccess().has('expenses.manage');
  const canPost = getAccess().has('expenses.post');

  const targetsFor = (type: string): Row[] =>
    type === 'plant' ? plants : type === 'vehicle' ? vehicles : type === 'site' ? sites : [];
  const targetLabel = (r: Row) => String(r.plantName ?? r.vehicleNo ?? r.siteName ?? r.id);

  async function reload() {
    const [v, h, p, ve, s] = await Promise.all([
      expensesApi.vouchers(), expensesApi.heads(), crud('plants').list(), crud('vehicles').list(), crud('sites').list(),
    ]);
    setRows(v); setHeads(h); setPlants(p); setVehicles(ve); setSites(s);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    setError(null); setMsg(null);
    const payloadLines = lines
      .filter((l) => l.expenseHeadId && Number(l.amount) > 0)
      .map((l) => ({
        expenseHeadId: l.expenseHeadId, description: l.description || undefined,
        amount: Number(l.amount), allocationType: l.allocationType,
        allocationId: l.allocationType === 'general' ? undefined : (l.allocationId || undefined),
      }));
    if (!payloadLines.length) { setError('Add at least one line with a head and amount'); return; }
    setBusy(true);
    try {
      const v = await expensesApi.createVoucher({ payee: payee || undefined, paymentMode: mode, plantId: plantId || undefined, voucherDate: new Date().toISOString().slice(0, 10), lines: payloadLines });
      setMsg(`Voucher ${String(v.voucherNo)} created (₹${money(v.totalAmount)}).`);
      setPayee(''); setPlantId(''); setLines([emptyLine()]);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null); setMsg(null);
    try { await fn(); await reload(); setMsg(okMsg); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function loadReport() {
    setError(null);
    try { setReport(await expensesApi.allocationReport()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  const byCostObject = (report?.byCostObject as { total: number; buckets: Bucket[] } | undefined) ?? null;
  const byHead = (report?.byHead as { total: number; buckets: Bucket[] } | undefined) ?? null;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Expense Vouchers</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Book driver bata, fuel and plant/site expenses; each line is allocated to a cost object.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canManage && (
        <div style={{ marginBottom: 18 }}>
          <Card title="New expense voucher">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ minWidth: 180 }}><Field label="Payee"><Input value={payee} placeholder="Paid to…" onChange={(e) => setPayee(e.target.value)} /></Field></div>
              <div style={{ width: 130 }}>
                <Field label="Mode">
                  <select className="mn-input" value={mode} onChange={(e) => setMode(e.target.value)}>
                    {PAYMENT_MODES.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 160 }}>
                <Field label="Booking plant">
                  <select className="mn-input" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                    <option value="">— none —</option>
                    {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <Table>
              <thead>
                <tr><Th>Head</Th><Th>Description</Th><Th numeric>Amount</Th><Th>Allocate to</Th><Th>Cost object</Th><Th /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <Td>
                      <select className="mn-input" value={l.expenseHeadId} onChange={(e) => setLine(i, { expenseHeadId: e.target.value })}>
                        <option value="">— select —</option>
                        {heads.map((h) => <option key={String(h.id)} value={String(h.id)}>{String(h.headName)}</option>)}
                      </select>
                    </Td>
                    <Td><Input style={{ width: 160 }} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Td>
                    <Td numeric><Input type="number" step="any" style={{ width: 110, textAlign: 'right' }} value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} /></Td>
                    <Td>
                      <select className="mn-input" value={l.allocationType} onChange={(e) => setLine(i, { allocationType: e.target.value, allocationId: '' })}>
                        {ALLOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Td>
                    <Td>
                      <select className="mn-input" value={l.allocationId} disabled={l.allocationType === 'general'} onChange={(e) => setLine(i, { allocationId: e.target.value })}>
                        <option value="">{l.allocationType === 'general' ? '—' : '— select —'}</option>
                        {targetsFor(l.allocationType).map((t) => <option key={String(t.id)} value={String(t.id)}>{targetLabel(t)}</option>)}
                      </select>
                    </Td>
                    <Td>{lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>Remove</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="secondary" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>Add line</Button>
              <Button onClick={create} loading={busy}>Create voucher</Button>
            </div>
          </Card>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="Expense vouchers" padded={false}>
          {rows.length ? (
            <Table>
              <thead><tr><Th>Voucher No</Th><Th>Date</Th><Th>Payee</Th><Th numeric>Total</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const status = String(r.status);
                  return (
                    <tr key={String(r.id)}>
                      <Td style={{ fontWeight: 600 }}>{String(r.voucherNo)}</Td>
                      <Td>{String(r.voucherDate ?? '—')}</Td>
                      <Td>{String(r.payee ?? '—')}</Td>
                      <Td numeric>₹{money(r.totalAmount)}</Td>
                      <Td><StatusBadge status={status} /></Td>
                      <Td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {canPost && status === 'draft' && (
                            <Button variant="secondary" size="sm" onClick={() => act(() => expensesApi.postVoucher(String(r.id)), `Voucher ${String(r.voucherNo)} posted.`)}>Post</Button>
                          )}
                          {canManage && status === 'draft' && (
                            <Button variant="ghost" size="sm" onClick={() => act(() => expensesApi.cancelVoucher(String(r.id)), `Voucher ${String(r.voucherNo)} cancelled.`)}>Cancel</Button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No expense vouchers yet" description={canManage ? 'Book your first voucher above.' : 'Nothing to show.'} />
          )}
        </Card>
      </div>

      <Card title="Cost-allocation report (posted)" padded={false}
        actions={<Button variant="secondary" size="sm" onClick={loadReport}>Refresh</Button>}
      >
        {byCostObject ? (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '14px 16px' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <p style={{ fontSize: 12, color: 'var(--mn-muted)', margin: '0 0 8px' }}>By cost object — total ₹{money(byCostObject.total)}</p>
              {byCostObject.buckets.length ? (
                <Table>
                  <thead><tr><Th>Cost object</Th><Th numeric>Amount</Th><Th numeric>Share</Th></tr></thead>
                  <tbody>
                    {byCostObject.buckets.map((b) => (
                      <tr key={b.key}><Td>{b.label}</Td><Td numeric>₹{money(b.amount)}</Td><Td numeric>{b.share}%</Td></tr>
                    ))}
                  </tbody>
                </Table>
              ) : <p style={{ fontSize: 13, color: 'var(--mn-muted)' }}>No posted expenses.</p>}
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <p style={{ fontSize: 12, color: 'var(--mn-muted)', margin: '0 0 8px' }}>By head — total ₹{money(byHead?.total ?? 0)}</p>
              {byHead && byHead.buckets.length ? (
                <Table>
                  <thead><tr><Th>Head</Th><Th numeric>Amount</Th><Th numeric>Share</Th></tr></thead>
                  <tbody>
                    {byHead.buckets.map((b) => (
                      <tr key={b.key}><Td>{b.label}</Td><Td numeric>₹{money(b.amount)}</Td><Td numeric>{b.share}%</Td></tr>
                    ))}
                  </tbody>
                </Table>
              ) : <p style={{ fontSize: 13, color: 'var(--mn-muted)' }}>No posted expenses.</p>}
            </div>
          </div>
        ) : (
          <EmptyState title="Allocation report" description="Refresh to roll posted expenses up by cost object and head." />
        )}
      </Card>
    </div>
  );
}
