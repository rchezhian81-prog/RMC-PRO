'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Sparkles, Upload } from 'lucide-react';
import { aiApi, type PoExtract } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { ErrorState } from '../../../../components/ui/States';

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

const money = (v: unknown) => (v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 }));
const val = (v: unknown) => (v == null || v === '' ? '—' : String(v));

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

  const fields: [string, unknown][] = data
    ? [
        ['Customer', data.customerName],
        ['Site / Project', data.siteName],
        ['PO number', data.poNumber],
        ['Order date', data.orderDate],
        ['Delivery date', data.deliveryDate],
        ['Contact', data.contactMobile],
      ]
    : [];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="mn-gradient" style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center' }}>
          <Sparkles size={18} color="#fff" />
        </span>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Import PO (AI)</h1>
          <p style={{ margin: 0, color: 'var(--mn-muted)', fontSize: 13 }}>
            Upload a customer purchase order (PDF or photo) — the AI reads the details for you.
          </p>
        </div>
      </div>

      <Card>
        {enabled === false ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mn-muted)' }}>
            PO reading isn&apos;t switched on yet. An administrator can enable it by setting an Anthropic API key on
            the server. Until then, enter orders from the Order Drafts screen.
          </p>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={onFile} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                icon={<Upload size={16} />}
                onClick={() => fileRef.current?.click()}
                loading={busy}
                disabled={enabled === null}
              >
                {busy ? 'Reading…' : 'Choose PO file'}
              </Button>
              {fileName && <span style={{ color: 'var(--mn-muted)', fontSize: 13 }}>{fileName}</span>}
            </div>
            {error && (
              <div style={{ marginTop: 12 }}>
                <ErrorState message={error} />
              </div>
            )}
          </>
        )}
      </Card>

      {data && (
        <>
          <Card title="Extracted details">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
              {fields.map(([label, v]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: 'var(--mn-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{val(v)}</div>
                </div>
              ))}
            </div>
            {data.notes && (
              <p style={{ marginTop: 14, marginBottom: 0, fontSize: 13, color: 'var(--mn-muted)' }}>
                <strong>Notes:</strong> {data.notes}
              </p>
            )}
          </Card>

          <Card title="Line items" padded={false}>
            {data.items?.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Grade</Th>
                    <Th numeric>Quantity (m³)</Th>
                    <Th numeric>Rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it, i) => (
                    <tr key={i}>
                      <Td>{val(it.grade)}</Td>
                      <Td numeric>{it.quantityM3 == null ? '—' : it.quantityM3}</Td>
                      <Td numeric>{money(it.rate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p style={{ padding: 16, margin: 0, color: 'var(--mn-muted)', fontSize: 13 }}>No line items detected.</p>
            )}
          </Card>

          <p style={{ color: 'var(--mn-subtle)', fontSize: 12, margin: 0 }}>
            Check these against the document, then create the quotation or order on the relevant screen. AI extraction can
            contain mistakes.
          </p>
        </>
      )}
    </div>
  );
}
