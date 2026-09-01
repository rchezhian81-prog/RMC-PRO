'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { billingReportsApi, downloadTallyCsv, type SalesRegister, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function BillingReportsPage() {
  const [gst, setGst] = useState<Row | null>(null);
  const [sales, setSales] = useState<SalesRegister | null>(null);
  const [hsn, setHsn] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [gstr3b, setGstr3b] = useState<{ output: Row; itc: Row; net: Row } | null>(null);
  const [dayBook, setDayBook] = useState<{ rows: Row[]; totals: Row; byMode: Row[] } | null>(null);
  const [margin, setMargin] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [collection, setCollection] = useState<{ rows: Row[]; totals: Row; periodDays: number } | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    const [g, s, h, r, l, d, mg, ce] = await Promise.all([
      billingReportsApi.gstSummary(from || undefined, to || undefined),
      billingReportsApi.salesRegister(from || undefined, to || undefined),
      billingReportsApi.hsnSummary(from || undefined, to || undefined),
      billingReportsApi.receiptsRegister(from || undefined, to || undefined),
      billingReportsApi.gstr3b(from || undefined, to || undefined),
      billingReportsApi.dayBook(from || undefined, to || undefined),
      billingReportsApi.gradeMargin(from || undefined, to || undefined),
      billingReportsApi.collectionEfficiency(from || undefined, to || undefined),
    ]);
    setGst(g); setSales(s); setHsn(h); setReceipts(r); setGstr3b(l); setDayBook(d); setMargin(mg); setCollection(ce);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const b2b = sales?.summary?.b2b;
  const b2c = sales?.summary?.b2c;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Billing Reports</h1>
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && (
            <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>
          )}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Filters every report on this page — GST/GSTR-3B, HSN, registers, receipts and the day book. Leave blank for all-time.</span>
        </div>
      </Card>

      <Card title="Tally export">
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px' }}>Download a Tally-ready sales CSV (Phase-1 file export — no live Tally API).</p>
        <Button icon={<Download size={16} />} onClick={() => downloadTallyCsv().then(() => setMsg('Tally CSV downloaded.')).catch((e) => setError(String(e)))}>
          Download Tally CSV
        </Button>
      </Card>

      <Card title="GST summary (issued invoices)" actions={gst ? <ExportButton rows={[gst]} columns={['taxable', 'cgst', 'sgst', 'igst', 'cess', 'total']} filename="gst-summary" /> : null}>
        {gst && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {(['taxable', 'cgst', 'sgst', 'igst', 'cess', 'total'] as const).map((k) => (
              <StatCard key={k} label={k} value={money(gst[k])} tone={k === 'total' ? 'info' : 'neutral'} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="GSTR-3B net liability"
        padded={false}
        actions={gstr3b ? <ExportButton rows={[{ ...gstr3b.output, kind: 'Output tax' }, { ...gstr3b.itc, kind: 'Input credit' }, { ...gstr3b.net, kind: 'Net payable' }]} columns={['kind', 'cgst', 'sgst', 'igst', 'cess', 'total']} filename="gstr-3b" /> : null}
      >
        {gstr3b ? (
          <Table>
            <thead>
              <tr>
                <Th>Head</Th>
                <Th numeric>CGST</Th>
                <Th numeric>SGST</Th>
                <Th numeric>IGST</Th>
                <Th numeric>Cess</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td style={{ fontWeight: 600 }}>Output tax (sales)</Td>
                <Td numeric>{money(gstr3b.output.cgst)}</Td>
                <Td numeric>{money(gstr3b.output.sgst)}</Td>
                <Td numeric>{money(gstr3b.output.igst)}</Td>
                <Td numeric>{money(gstr3b.output.cess)}</Td>
                <Td numeric>{money(gstr3b.output.total)}</Td>
              </tr>
              <tr>
                <Td style={{ fontWeight: 600 }}>Less: input credit (purchases)</Td>
                <Td numeric>{money(gstr3b.itc.cgst)}</Td>
                <Td numeric>{money(gstr3b.itc.sgst)}</Td>
                <Td numeric>{money(gstr3b.itc.igst)}</Td>
                <Td numeric><span style={{ color: 'var(--mn-muted)' }}>—</span></Td>
                <Td numeric>{money(gstr3b.itc.total)}</Td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <Td style={{ fontWeight: 700 }}>Net payable</Td>
                <Td numeric style={{ fontWeight: 700 }}>{money(gstr3b.net.cgst)}</Td>
                <Td numeric style={{ fontWeight: 700 }}>{money(gstr3b.net.sgst)}</Td>
                <Td numeric style={{ fontWeight: 700 }}>{money(gstr3b.net.igst)}</Td>
                <Td numeric style={{ fontWeight: 700 }}>{money(gstr3b.net.cess)}</Td>
                <Td numeric style={{ fontWeight: 700 }}>{money(gstr3b.net.total)}</Td>
              </tr>
            </tfoot>
          </Table>
        ) : (
          !loaded && <TableSkeleton cols={6} />
        )}
      </Card>

      <Card
        title="HSN / SAC summary (GSTR-1 Table 12)"
        padded={false}
        actions={<ExportButton rows={hsn?.rows ?? []} columns={['hsn', 'gstRate', 'quantity', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'total']} filename="hsn-summary" />}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : hsn?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>HSN/SAC</Th>
                <Th numeric>Rate %</Th>
                <Th numeric>Qty</Th>
                <Th numeric>Taxable</Th>
                <Th numeric>CGST</Th>
                <Th numeric>SGST</Th>
                <Th numeric>IGST</Th>
                <Th numeric>Cess</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {hsn.rows.map((r, i) => (
                <tr key={i}>
                  <Td style={{ fontWeight: 600 }}>{String(r.hsn)}</Td>
                  <Td numeric>{qty(r.gstRate)}</Td>
                  <Td numeric>{qty(r.quantity)}</Td>
                  <Td numeric>{money(r.taxable)}</Td>
                  <Td numeric>{money(r.cgst)}</Td>
                  <Td numeric>{money(r.sgst)}</Td>
                  <Td numeric>{money(r.igst)}</Td>
                  <Td numeric>{money(r.cess)}</Td>
                  <Td numeric>{money(r.total)}</Td>
                </tr>
              ))}
            </tbody>
            {hsn.totals && (
              <tfoot>
                <tr>
                  <Td style={{ fontWeight: 700 }}>All HSN</Td>
                  <Td />
                  <Td numeric style={{ fontWeight: 700 }}>{qty(hsn.totals.quantity)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.taxable)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.cgst)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.sgst)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.igst)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.cess)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.total)}</Td>
                </tr>
              </tfoot>
            )}
          </Table>
        ) : (
          <EmptyState title="No line items" description="Issued invoices in the period will summarise here by HSN and rate." />
        )}
      </Card>

      {b2b && b2c && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <StatCard label="B2B (registered)" value={money(b2b.total)} tone="info" />
          <StatCard label="B2B invoices" value={String(b2b.count)} />
          <StatCard label="B2C (unregistered)" value={money(b2c.total)} tone="neutral" />
          <StatCard label="B2C invoices" value={String(b2c.count)} />
        </div>
      )}

      <Card
        title={`Sales register${sales ? ` — ${sales.count} invoices · taxable ${money(sales.taxable)} · total ${money(sales.total)}` : ''}`}
        padded={false}
        actions={
          <ExportButton
            rows={sales?.rows ?? []}
            columns={['invoiceNo', 'invoiceDate', 'gstin', 'placeOfSupply', 'taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'totalAmount']}
            filename="sales-register"
          />
        }
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : sales?.rows?.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Date</Th>
                  <Th>GSTIN</Th>
                  <Th>Place of supply</Th>
                  <Th numeric>Taxable</Th>
                  <Th numeric>CGST</Th>
                  <Th numeric>SGST</Th>
                  <Th numeric>IGST</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {sales.rows.map((r) => (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600 }}>{String(r.invoiceNo)}</Td>
                    <Td>{String(r.invoiceDate ?? '—')}</Td>
                    <Td>{r.gstin ? String(r.gstin) : <span style={{ color: 'var(--mn-muted)' }}>B2C</span>}</Td>
                    <Td>{String(r.placeOfSupply ?? '—')}</Td>
                    <Td numeric>{money(r.taxableAmount)}</Td>
                    <Td numeric>{money(r.cgstAmount)}</Td>
                    <Td numeric>{money(r.sgstAmount)}</Td>
                    <Td numeric>{money(r.igstAmount)}</Td>
                    <Td numeric>{money(r.totalAmount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No issued invoices" />
        )}
      </Card>

      <Card
        title="Receipts register"
        padded={false}
        actions={
          <ExportButton
            rows={receipts}
            columns={['receiptNo', 'receiptDate', 'paymentMode', 'amount', 'allocatedAmount']}
            filename="receipts-register"
          />
        }
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : receipts.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th>Date</Th>
                <Th>Mode</Th>
                <Th numeric>Amount</Th>
                <Th numeric>Allocated</Th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.receiptNo)}</Td>
                  <Td>{String(r.receiptDate ?? '—')}</Td>
                  <Td>{String(r.paymentMode ?? '')}</Td>
                  <Td numeric>{money(r.amount)}</Td>
                  <Td numeric>{money(r.allocatedAmount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No receipts" />
        )}
      </Card>

      {dayBook?.totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Cash in" value={money(dayBook.totals.inflow)} tone="success" />
          <StatCard label="Cash out" value={money(dayBook.totals.outflow)} tone="danger" />
          <StatCard label="Net movement" value={money(dayBook.totals.net)} tone="info" />
          <StatCard label="Entries" value={String(dayBook.totals.count ?? 0)} />
        </div>
      )}

      {dayBook?.byMode?.length ? (
        <Card title="By payment mode" padded={false} actions={<ExportButton rows={dayBook.byMode} columns={['mode', 'inflow', 'outflow', 'net']} filename="day-book-by-mode" />}>
          <Table>
            <thead><tr><Th>Mode</Th><Th numeric>In</Th><Th numeric>Out</Th><Th numeric>Net</Th></tr></thead>
            <tbody>
              {dayBook.byMode.map((r, i) => (
                <tr key={i}>
                  <Td style={{ fontWeight: 600 }}>{String(r.mode)}</Td>
                  <Td numeric>{money(r.inflow)}</Td>
                  <Td numeric>{money(r.outflow)}</Td>
                  <Td numeric style={{ fontWeight: 600 }}>{money(r.net)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card
        title="Cash / bank day book"
        padded={false}
        actions={<ExportButton rows={dayBook?.rows ?? []} columns={['date', 'kind', 'ref', 'mode', 'party', 'inflow', 'outflow']} filename="day-book" />}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : dayBook?.rows?.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Reference</Th>
                  <Th>Mode</Th>
                  <Th>Party</Th>
                  <Th numeric>In</Th>
                  <Th numeric>Out</Th>
                </tr>
              </thead>
              <tbody>
                {dayBook.rows.map((r, i) => (
                  <tr key={i}>
                    <Td>{String(r.date ?? '—')}</Td>
                    <Td>{String(r.kind)}</Td>
                    <Td style={{ fontWeight: 600 }}>{String(r.ref)}</Td>
                    <Td>{String(r.mode)}</Td>
                    <Td>{r.party ? String(r.party) : <span style={{ color: 'var(--mn-muted)' }}>—</span>}</Td>
                    <Td numeric>{Number(r.inflow) ? money(r.inflow) : ''}</Td>
                    <Td numeric>{Number(r.outflow) ? money(r.outflow) : ''}</Td>
                  </tr>
                ))}
              </tbody>
              {dayBook.totals && (
                <tfoot>
                  <tr>
                    <Td style={{ fontWeight: 700 }}>Totals</Td>
                    <Td /><Td /><Td /><Td />
                    <Td numeric style={{ fontWeight: 700 }}>{money(dayBook.totals.inflow)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(dayBook.totals.outflow)}</Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : (
          <EmptyState title="No movements" description="Receipts, vendor payments and expense vouchers in the period appear here." />
        )}
      </Card>

      <Card
        title={`Gross margin per m³${margin?.totals ? ` — ₹${qty(margin.totals.grossMarginPerM3)}/m³ (${margin.totals.marginPct == null ? '—' : `${qty(margin.totals.marginPct)}%`})` : ''}`}
        padded={false}
        actions={<ExportButton rows={margin?.rows ?? []} columns={['gradeLabel', 'volumeM3', 'revenue', 'revenuePerM3', 'stdMaterialCostPerM3', 'grossMarginPerM3', 'marginPct']} filename="gross-margin-per-m3" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : margin?.rows?.length ? (
          <>
          <p style={{ padding: '8px 14px 0', margin: 0, color: 'var(--mn-muted)', fontSize: 12 }}>
            Invoiced revenue vs standard material cost (mix recipe × material rate). Excludes labour, power, transport &amp; overheads.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Grade</Th>
                <Th numeric>Volume m³</Th>
                <Th numeric>Revenue/m³</Th>
                <Th numeric>Material cost/m³</Th>
                <Th numeric>Margin/m³</Th>
                <Th numeric>Margin %</Th>
              </tr>
            </thead>
            <tbody>
              {margin.rows.map((r, i) => {
                const mPerM3 = Number(r.grossMarginPerM3 ?? 0);
                const tone = mPerM3 < 0 ? 'var(--mn-danger)' : mPerM3 > 0 ? 'var(--mn-success)' : 'inherit';
                return (
                  <tr key={i}>
                    <Td style={{ fontWeight: 600 }}>{String(r.gradeLabel ?? '')}</Td>
                    <Td numeric>{qty(r.volumeM3)}</Td>
                    <Td numeric>{money(r.revenuePerM3)}</Td>
                    <Td numeric>{money(r.stdMaterialCostPerM3)}</Td>
                    <Td numeric style={{ color: tone, fontWeight: 600 }}>{money(r.grossMarginPerM3)}</Td>
                    <Td numeric>{r.marginPct == null ? '—' : `${qty(r.marginPct)}%`}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          </>
        ) : (
          <EmptyState title="No invoiced grades in range" description="Needs issued invoices with grade lines and an approved mix design to cost against." />
        )}
      </Card>

      {collection?.totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Billed" value={money(collection.totals.billed)} />
          <StatCard label="Collected" value={money(collection.totals.collected)} tone="info" />
          <StatCard label="Collection efficiency" value={collection.totals.efficiencyPct == null ? '—' : `${qty(collection.totals.efficiencyPct)}%`} />
          <StatCard label={`DSO (${collection.periodDays}d basis)`} value={collection.totals.dsoDays == null ? '—' : `${qty(collection.totals.dsoDays)}d`} />
        </div>
      )}

      <Card
        title="Collection efficiency & DSO"
        padded={false}
        actions={<ExportButton rows={collection?.rows ?? []} columns={['customerName', 'billed', 'collected', 'outstanding', 'efficiencyPct', 'dsoDays']} filename="collection-efficiency" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : collection?.rows?.length ? (
          <>
          <p style={{ padding: '8px 14px 0', margin: 0, color: 'var(--mn-muted)', fontSize: 12 }}>
            Billed &amp; collected are for the period; outstanding is the current AR balance. Efficiency = collected ÷ billed; DSO = outstanding × {collection.periodDays} ÷ billed. Slowest payers first.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th numeric>Billed</Th>
                  <Th numeric>Collected</Th>
                  <Th numeric>Outstanding</Th>
                  <Th numeric>Efficiency</Th>
                  <Th numeric>DSO</Th>
                </tr>
              </thead>
              <tbody>
                {collection.rows.map((r, i) => {
                  const dso = r.dsoDays == null ? null : Number(r.dsoDays);
                  const tone = dso != null && dso > 90 ? 'var(--mn-danger)' : dso != null && dso > 60 ? 'var(--mn-warning)' : 'inherit';
                  return (
                    <tr key={i}>
                      <Td style={{ fontWeight: 600 }}>{String(r.customerName ?? '')}</Td>
                      <Td numeric>{money(r.billed)}</Td>
                      <Td numeric>{money(r.collected)}</Td>
                      <Td numeric>{money(r.outstanding)}</Td>
                      <Td numeric>{r.efficiencyPct == null ? '—' : `${qty(r.efficiencyPct)}%`}</Td>
                      <Td numeric style={{ color: tone, fontWeight: tone === 'inherit' ? 400 : 600 }}>{r.dsoDays == null ? '—' : `${qty(r.dsoDays)}d`}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          </>
        ) : (
          <EmptyState title="No billing activity in range" description="Issue invoices and record receipts to measure collection efficiency." />
        )}
      </Card>
    </div>
  );
}
