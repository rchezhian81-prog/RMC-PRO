'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Share2 } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { creditNotesApi, invoicesApi, openPdf, openWhatsAppShare, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * GST credit and debit notes. A note is raised from the invoice it amends
 * (Billing → Invoices → open the invoice); this screen lists every note,
 * issues drafts, prints and sends them, and cancels them.
 */
export default function CreditNotesPage() {
  const { confirm, prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [invoiceNo, setInvoiceNo] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const win = useListWindow();
  const canApprove = getAccess().has('invoice_cancellation.approve');

  async function reload() {
    const [notes, invoices] = await Promise.all([creditNotesApi.list(undefined, win.limit), invoicesApi.list(undefined, 5000)]);
    setRows(notes);
    setInvoiceNo(new Map(invoices.map((i) => [String(i.id), String(i.invoiceNo ?? '')])));
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, [win.limit]);

  async function act(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      const out = await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Credit / debit notes</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>
        A credit note reduces what a customer owes on an issued invoice — a rate difference, a shortfall, a return after billing; a debit note adds to it.
        Raise one from the invoice: Billing → Invoices → open the invoice → Credit note / Debit note.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <div style={{ marginBottom: 14, color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}
      <Card title="Notes" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Note</Th>
                <Th>Type</Th>
                <Th>Date</Th>
                <Th>Against invoice</Th>
                <Th>Reason</Th>
                <Th numeric>Total</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = String(r.status);
                const id = String(r.id);
                const no = String(r.noteNo ?? '');
                return (
                  <tr key={id}>
                    <Td style={{ fontWeight: 600 }}>{no || <span style={{ color: 'var(--mn-text-muted)', fontWeight: 500 }}>Draft</span>}</Td>
                    <Td>{r.noteType === 'debit' ? 'Debit' : 'Credit'}</Td>
                    <Td>{formatDate(r.noteDate)}</Td>
                    <Td><Link href={`/app/billing/invoices/${String(r.invoiceId)}`}>{invoiceNo.get(String(r.invoiceId)) || 'invoice'}</Link></Td>
                    <Td>{String(r.reason ?? '—').replace(/_/g, ' ')}</Td>
                    <Td numeric>₹{money(r.totalAmount)}</Td>
                    <Td><StatusBadge status={status} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/credit-notes/${id}/pdf`, no || `Draft ${r.noteType === 'debit' ? 'debit' : 'credit'} note`).catch((e) => setError(String(e)))}>Print</Button>
                        {status === 'issued' && (
                          <Button variant="secondary" size="sm" icon={<Share2 size={14} />} onClick={async () => {
                            const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile', defaultValue: '' });
                            if (m === null) return;
                            act(() => openWhatsAppShare(() => creditNotesApi.share(id, m)));
                          }}>Share</Button>
                        )}
                        {canApprove && status === 'draft' && (
                          <Button size="sm" onClick={async () => {
                            if (!(await confirm({ title: `Issue ${r.noteType === 'debit' ? 'debit' : 'credit'} note`, message: `Issue this note for ₹${money(r.totalAmount)} against ${invoiceNo.get(String(r.invoiceId)) || 'the invoice'}? It takes a number and changes what the customer owes.`, confirmLabel: 'Issue' }))) return;
                            act(() => creditNotesApi.issue(id), 'Note issued.');
                          }}>Issue</Button>
                        )}
                        {canApprove && status !== 'cancelled' && (
                          <Button variant="ghost" size="sm" onClick={async () => {
                            if (!(await confirm({ title: 'Cancel note', message: status === 'issued' ? `Cancel ${no}? The invoice gets its balance back; the number stays used, as GST requires.` : 'Discard this draft?', confirmLabel: 'Cancel note', danger: true }))) return;
                            const reason = status === 'issued' ? await prompt({ title: 'Cancel note', label: 'Reason', defaultValue: '' }) : '';
                            if (reason === null) return;
                            act(() => creditNotesApi.cancel(id, reason), 'Note cancelled.');
                          }}>Cancel</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No credit or debit notes" description="Raise one from an issued invoice when something on it has to change after the fact." />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="notes" />
      </Card>
    </div>
  );
}
