'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, ClipboardList, FileSignature, FileText, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { aiApi, type PoExtract } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format-date';
import { money } from '../../../../lib/money';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

/**
 * Import PO — read a customer's purchase order with AI.
 *
 * One card to drop the PDF or photo on, then what was read: the header
 * facts (customer, site, PO number, dates, contact) as a fact list, the
 * grade lines as a table with a total, any notes, and where to take it next
 * (a quotation or a rate contract). The page says up front when the feature
 * is switched off, and reminds that what was read must be checked against
 * the document. Same layout in both skins; every colour reads the semantic
 * tokens.
 */

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const val = (v: unknown) => (v == null || v === '' ? '—' : String(v));
const dateOrText = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? formatDate(v) : val(v));

export default function ImportPoPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PoExtract | null>(null);
  const [fileName, setFileName] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = still checking
  const fileRef = useRef<HTMLInputElement>(null);

  // Check up front rather than letting someone pick a file, wait for the
  // upload, and only then be told the feature is off.
  useEffect(() => {
    aiApi
      .status()
      .then((r) => setEnabled(Boolean(r.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setData(null);
    setFileName(f.name);
    setBusy(true);
    try {
      const b64 = await readAsBase64(f);
      const { extracted } = await aiApi.extractPo(b64, f.type || 'application/octet-stream');
      setData(extracted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that document.');
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];
  const totalM3 = items.reduce((t, it) => t + num(it.quantityM3), 0);
  const totalValue = items.reduce((t, it) => t + num(it.quantityM3) * num(it.rate), 0);
  const priced = items.filter((it) => it.rate != null).length;

  return (
    <div className="mn-ord mn-po">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Import a purchase order</h1>
          <p>Upload the customer&rsquo;s purchase order as a PDF or a photo and the details are read for you: who, where, the PO number and dates, and the grades with quantities and rates. Check them against the document, then raise the quotation or book the order.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Sparkles size={14} aria-hidden />
            {enabled === null ? 'Checking…' : enabled ? 'AI reading is on' : 'AI reading is off'}
          </span>
          {data && <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => { setData(null); setFileName(''); setError(null); }}>Start over</Button>}
        </div>
      </header>

      {error && <ErrorState message={error} />}

      <Card title={<span className="mn-board-card-title"><Upload size={16} aria-hidden /> The document</span>}>
        {enabled === false ? (
          <EmptyState
            icon={<Sparkles size={22} aria-hidden />}
            title="PO reading is not switched on"
            description="An administrator can enable it by setting an Anthropic API key on the server. Until then, key the order in from the quotation or the rate contract."
            action={<Link href="/app/sales/quotations" className="mn-ord-link"><Button variant="secondary" size="sm" icon={<FileText size={14} />}>Quotations</Button></Link>}
          />
        ) : (
          <div className="mn-po-drop">
            <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={onFile} style={{ display: 'none' }} />
            <Button icon={<Upload size={16} />} onClick={() => fileRef.current?.click()} loading={busy} disabled={enabled === null}>
              {busy ? 'Reading the document…' : data ? 'Choose another file' : 'Choose the PO file'}
            </Button>
            <span className="mn-ord-meta">{fileName || 'A PDF, or a clear photo of the printed order. One page at a time reads best.'}</span>
          </div>
        )}
      </Card>

      {data && (
        <>
          <div className="mn-ord-note mn-ord-note--warn" role="status">
            <AlertTriangle size={16} aria-hidden />
            <span><strong>Check every figure against the document before using it.</strong> Reading a scan can miss or misread a number; nothing below has been saved yet.</span>
          </div>

          <div className="mn-po-grid">
            <Card title={<span className="mn-board-card-title"><ClipboardList size={16} aria-hidden /> What was read</span>}>
              <dl className="mn-od-money mn-od-money--tight">
                <div><dt>Customer</dt><dd>{val(data.customerName)}</dd></div>
                <div><dt>Site / project</dt><dd>{val(data.siteName)}</dd></div>
                <div><dt>PO number</dt><dd>{val(data.poNumber)}</dd></div>
                <div><dt>Order date</dt><dd>{dateOrText(data.orderDate)}</dd></div>
                <div><dt>Delivery date</dt><dd>{dateOrText(data.deliveryDate)}</dd></div>
                <div><dt>Contact</dt><dd>{val(data.contactMobile)}</dd></div>
              </dl>
              {data.notes ? <p className="mn-board-form-hint"><strong>Notes on the order:</strong> {data.notes}</p> : null}
            </Card>

            <Card title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Grade lines <span className="mn-board-card-count">{items.length}</span></span>} padded={false}>
              {items.length ? (
                <div className="mn-id-scroll">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Grade</Th>
                        <Th numeric>Quantity</Th>
                        <Th numeric>Rate/m³</Th>
                        <Th numeric>Line value</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i}>
                          <Td><span className="mn-od-grade">{val(it.grade)}</span></Td>
                          <Td numeric className="mn-od-num">{it.quantityM3 == null ? '—' : `${qty(it.quantityM3)} m³`}</Td>
                          <Td numeric>{it.rate == null ? <span className="mn-ord-meta">not on the PO</span> : money(it.rate)}</Td>
                          <Td numeric className="mn-od-num">{it.rate == null || it.quantityM3 == null ? '—' : money(num(it.quantityM3) * num(it.rate))}</Td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="mn-ir-total">
                        <Td>{items.length} {items.length === 1 ? 'line' : 'lines'}{priced < items.length ? ` · ${items.length - priced} without a rate` : ''}</Td>
                        <Td numeric>{qty(totalM3)} m³</Td>
                        <Td />
                        <Td numeric><span className="mn-ir-total-value">{priced ? money(totalValue) : '—'}</span></Td>
                      </tr>
                    </tfoot>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No grade lines found" description="The document may list the concrete in a table the reader could not follow. Key the lines in by hand on the quotation." />
              )}
            </Card>
          </div>

          <Card title={<span className="mn-board-card-title"><Sparkles size={16} aria-hidden /> Next</span>}>
            <p className="mn-board-form-hint" style={{ marginTop: 0 }}>Nothing is created from here automatically. Take the figures to the screen that fits:</p>
            <div className="mn-po-next">
              <Link href="/app/sales/quotations" className="mn-ord-link"><Button variant="secondary" size="sm" icon={<FileText size={14} />}>Raise a quotation</Button></Link>
              <Link href="/app/sales/rate-contracts" className="mn-ord-link"><Button variant="ghost" size="sm" icon={<FileSignature size={14} />}>Book under a rate contract</Button></Link>
              <Link href="/app/entity/customers" className="mn-ord-link"><Button variant="ghost" size="sm">Add the customer first</Button></Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
