'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { crud, orderDraftsApi, rateContractsApi, type Row } from '../../../../../lib/api';
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
 * A number field, at module scope so it keeps the same <input> across renders.
 * Declared inside the page it would be a new component type on every keystroke,
 * remounting the input and dropping focus after each digit.
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

export default function RateContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { prompt } = useConfirm();
  const router = useRouter();
  const [rc, setRc] = useState<Row | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [item, setItem] = useState({ gradeId: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [hdr, setHdr] = useState({ validFrom: '', validTo: '', paymentTerms: '', transportTerms: '', pumpTerms: '', remarks: '' });
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [itemEdit, setItemEdit] = useState({ ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [full, g] = await Promise.all([rateContractsApi.get(id), crud('concrete-grades').list()]);
    setRc(full);
    setHdr({
      validFrom: String(full.validFrom ?? ''),
      validTo: String(full.validTo ?? ''),
      paymentTerms: String(full.paymentTerms ?? ''),
      transportTerms: String(full.transportTerms ?? ''),
      pumpTerms: String(full.pumpTerms ?? ''),
      remarks: String(full.remarks ?? ''),
    });
    setGrades(g);
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
      await rateContractsApi.addItem(id, {
        gradeId: item.gradeId || undefined,
        gradeLabel: g ? String(g.gradeCode) : '',
        ratePerM3: Number(item.ratePerM3 || 0),
        transportCharge: Number(item.transportCharge || 0),
        pumpCharge: Number(item.pumpCharge || 0),
        waitingCharge: Number(item.waitingCharge || 0),
      });
      setItem({ gradeId: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
    });
  }

  async function saveHeader() {
    await run(() => rateContractsApi.update(id, {
      validFrom: hdr.validFrom || null,
      validTo: hdr.validTo || null,
      paymentTerms: hdr.paymentTerms,
      transportTerms: hdr.transportTerms,
      pumpTerms: hdr.pumpTerms,
      remarks: hdr.remarks,
    }), 'Contract details saved');
  }

  function startEditItem(it: Row) {
    setEditingItem(String(it.id));
    setItemEdit({
      ratePerM3: String(it.ratePerM3 ?? ''),
      transportCharge: String(it.transportCharge ?? ''),
      pumpCharge: String(it.pumpCharge ?? ''),
      waitingCharge: String(it.waitingCharge ?? ''),
    });
  }

  async function saveEditItem(itemId: string) {
    await run(async () => {
      await rateContractsApi.updateItem(id, itemId, {
        ratePerM3: Number(itemEdit.ratePerM3 || 0),
        transportCharge: Number(itemEdit.transportCharge || 0),
        pumpCharge: Number(itemEdit.pumpCharge || 0),
        waitingCharge: Number(itemEdit.waitingCharge || 0),
      });
      setEditingItem(null);
    }, 'Rate updated');
  }

  async function convert() {
    const lines = ((rc?.items as Row[]) ?? [])
      .map((it) => ({ gradeId: it.gradeId, gradeLabel: it.gradeLabel, quantityM3: Number(qty[String(it.id)] || 0) }))
      .filter((l) => l.quantityM3 > 0);
    if (!lines.length) {
      setError('Enter a quantity for at least one grade');
      return;
    }
    await run(async () => {
      const od = await orderDraftsApi.fromRateContract(id, { lines });
      setMsg(`Order draft ${String(od.orderNo)} created`);
    });
  }

  if (!rc) return error ? <ErrorState message={error} /> : <Loading label="Loading rate contract…" />;
  const items = (rc.items as Row[]) ?? [];
  const status = String(rc.approvalStatus);
  const locked = status === 'approved';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/app/sales/rate-contracts')}>
          Rate Contracts
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{String(rc.rateContractNo)}</h1>
        <StatusBadge status={status} />
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <div style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}

      <Card title="Actions">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {status === 'draft' && <Button onClick={() => run(() => rateContractsApi.submit(id), 'Submitted')}>Submit</Button>}
          {status === 'rejected' && <Button onClick={() => run(() => rateContractsApi.submit(id), 'Re-submitted')}>Re-submit</Button>}
          {status === 'submitted' && <Button onClick={() => run(() => rateContractsApi.approve(id), 'Approved')}>Approve</Button>}
          {status === 'submitted' && <Button variant="secondary" onClick={() => run(async () => { const reason = await prompt({ title: 'Reject rate contract', label: 'Rejection reason', defaultValue: '' }); if (reason !== null) await rateContractsApi.reject(id, reason || 'Not accepted'); }, 'Rate contract rejected')}>Reject</Button>}
        </div>
      </Card>

      <Card title="Contract details">
        {locked ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
            <div><span style={{ color: 'var(--mn-muted)' }}>Valid from</span><br />{String(rc.validFrom ?? '—')}</div>
            <div><span style={{ color: 'var(--mn-muted)' }}>Valid to</span><br />{String(rc.validTo ?? '—')}</div>
            <div><span style={{ color: 'var(--mn-muted)' }}>Payment terms</span><br />{String(rc.paymentTerms ?? '—')}</div>
            <div><span style={{ color: 'var(--mn-muted)' }}>Transport terms</span><br />{String(rc.transportTerms ?? '—')}</div>
            <div><span style={{ color: 'var(--mn-muted)' }}>Pump terms</span><br />{String(rc.pumpTerms ?? '—')}</div>
            <div><span style={{ color: 'var(--mn-muted)' }}>Remarks</span><br />{String(rc.remarks ?? '—')}</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              <div style={{ minWidth: 150 }}><Field label="Valid from"><Input type="date" value={hdr.validFrom} onChange={(e) => setHdr({ ...hdr, validFrom: e.target.value })} /></Field></div>
              <div style={{ minWidth: 150 }}><Field label="Valid to"><Input type="date" value={hdr.validTo} onChange={(e) => setHdr({ ...hdr, validTo: e.target.value })} /></Field></div>
              <div style={{ minWidth: 160 }}><Field label="Payment terms"><Input value={hdr.paymentTerms} onChange={(e) => setHdr({ ...hdr, paymentTerms: e.target.value })} /></Field></div>
              <div style={{ minWidth: 160 }}><Field label="Transport terms"><Input value={hdr.transportTerms} onChange={(e) => setHdr({ ...hdr, transportTerms: e.target.value })} /></Field></div>
              <div style={{ minWidth: 160 }}><Field label="Pump terms"><Input value={hdr.pumpTerms} onChange={(e) => setHdr({ ...hdr, pumpTerms: e.target.value })} /></Field></div>
              <div style={{ minWidth: 200, flex: 1 }}><Field label="Remarks"><Input value={hdr.remarks} onChange={(e) => setHdr({ ...hdr, remarks: e.target.value })} /></Field></div>
            </div>
            <div><Button variant="secondary" onClick={saveHeader}>Save details</Button></div>
          </div>
        )}
      </Card>

      <Card title="Grade-wise agreed rates" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Grade</Th>
              <Th numeric>Rate/m³</Th>
              <Th numeric>Transport</Th>
              <Th numeric>Pump</Th>
              <Th numeric>Waiting</Th>
              {locked && <Th numeric>Order qty m³</Th>}
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const editing = editingItem === String(it.id);
              const cell = (k: 'ratePerM3' | 'transportCharge' | 'pumpCharge' | 'waitingCharge') =>
                editing ? (
                  <Td numeric>
                    <Input type="number" step="any" style={{ width: 90, textAlign: 'right' }} value={itemEdit[k]} onChange={(e) => setItemEdit({ ...itemEdit, [k]: e.target.value })} />
                  </Td>
                ) : (
                  <Td numeric>{money(it[k])}</Td>
                );
              return (
                <tr key={it.id}>
                  <Td>{String(it.gradeLabel ?? '')}</Td>
                  {cell('ratePerM3')}
                  {cell('transportCharge')}
                  {cell('pumpCharge')}
                  {cell('waitingCharge')}
                  {locked && (
                    <Td numeric>
                      <Input type="number" step="any" style={{ width: 90, textAlign: 'right' }} value={qty[String(it.id)] ?? ''} onChange={(e) => setQty({ ...qty, [String(it.id)]: e.target.value })} />
                    </Td>
                  )}
                  <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!locked && (editing ? (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => saveEditItem(String(it.id))}>Save</Button>{' '}
                        <Button variant="ghost" size="sm" onClick={() => setEditingItem(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => startEditItem(it)}>Edit</Button>{' '}
                        <Button variant="ghost" size="sm" onClick={() => run(() => rateContractsApi.deleteItem(id, String(it.id)))}>Remove</Button>
                      </>
                    ))}
                  </Td>
                </tr>
              );
            })}
            {!items.length && (
              <tr>
                <Td colSpan={locked ? 7 : 6} style={{ color: 'var(--mn-muted)' }}>No items yet.</Td>
              </tr>
            )}
          </tbody>
        </Table>
        {!locked && (
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
            <Num label="Rate/m³" v={item.ratePerM3} on={(v) => setItem({ ...item, ratePerM3: v })} />
            <Num label="Transport" v={item.transportCharge} on={(v) => setItem({ ...item, transportCharge: v })} />
            <Num label="Pump" v={item.pumpCharge} on={(v) => setItem({ ...item, pumpCharge: v })} />
            <Num label="Waiting" v={item.waitingCharge} on={(v) => setItem({ ...item, waitingCharge: v })} />
            <div style={{ marginBottom: 14 }}>
              <Button type="submit" variant="secondary">Add rate</Button>
            </div>
          </Form>
        )}
      </Card>

      {locked && (
        <Card title="Convert to order draft">
          <p style={{ color: 'var(--mn-muted)', fontSize: 12, marginTop: 0 }}>
            Enter order quantities per grade above, then create a draft order (handoff to operations).
          </p>
          <Button onClick={convert}>Convert → Order draft</Button>
        </Card>
      )}
    </div>
  );
}
