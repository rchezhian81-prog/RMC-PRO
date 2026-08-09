'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { company } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState } from '../../../components/ui/States';

/**
 * The plant's own legal identity, grouped the way it reads on a tax invoice.
 * Every field is what customers, auditors and the GST portal expect to see, so
 * the sections mirror an invoice: who you are, where you are, how to reach you,
 * and where to pay.
 */
const SECTIONS: Array<{ title: string; help?: string; fields: Array<[string, string, string?]> }> = [
  {
    title: 'Identity',
    help: 'Shown at the top of every invoice and quotation.',
    fields: [
      ['companyName', 'Company name (trading name)'],
      ['legalName', 'Registered legal name', 'If different from the trading name'],
      ['gstin', 'GSTIN', '15-character GST number'],
      ['pan', 'PAN'],
    ],
  },
  {
    title: 'Address',
    help: 'Your plant / registered address. The state decides CGST+SGST vs IGST on invoices.',
    fields: [
      ['addressLine1', 'Address line 1'],
      ['addressLine2', 'Address line 2'],
      ['city', 'City'],
      ['state', 'State'],
      ['pincode', 'PIN code'],
    ],
  },
  {
    title: 'Contact',
    fields: [
      ['phone', 'Phone'],
      ['email', 'Email'],
      ['website', 'Website'],
    ],
  },
  {
    title: 'Bank details',
    help: 'Printed on the invoice so customers know where to pay.',
    fields: [
      ['bankName', 'Bank name'],
      ['bankAccountNo', 'Account number'],
      ['bankIfsc', 'IFSC'],
      ['bankBranch', 'Branch'],
    ],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map(([k]) => k));

/** Logo rules, kept in step with the server (apps/api/src/setup/logo.ts). */
const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_ACCEPT = 'image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg';
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];

/** Read a File as a base64 string with no data-URL prefix. */
function fileToBase64(file: File): Promise<{ mime: string; base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      resolve({ mime: file.type || 'image/svg+xml', base64, dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

export default function CompanyPage() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Logo state. `preview` is the data URL shown; `hasServerLogo` gates Remove;
  // `pending` holds a chosen-but-unsaved file so Save/Remove are explicit.
  const [preview, setPreview] = useState<string | null>(null);
  const [hasServerLogo, setHasServerLogo] = useState(false);
  const [pending, setPending] = useState<{ mime: string; base64: string } | null>(null);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  useEffect(() => {
    company
      .get()
      .then((c) => {
        if (c) {
          const rec = c as Record<string, unknown>;
          const next: Record<string, string> = {};
          for (const k of ALL_KEYS) next[k] = String(rec[k] ?? '');
          setForm(next);
          if (rec.logoData && rec.logoMime) {
            setPreview(`data:${String(rec.logoMime)};base64,${String(rec.logoData)}`);
            setHasServerLogo(true);
          }
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoMsg(null);
    setLogoErr(null);
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after a remove
    if (!file) return;
    const isSvgByName = /\.svg$/i.test(file.name);
    if (!LOGO_TYPES.includes(file.type) && !isSvgByName) {
      setLogoErr('Logo must be a PNG, JPG or SVG image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoErr(`Logo must be ${Math.round(LOGO_MAX_BYTES / 1024)} KB or smaller.`);
      return;
    }
    try {
      const { mime, base64, dataUrl } = await fileToBase64(file);
      setPreview(dataUrl);
      setPending({ mime: mime && LOGO_TYPES.includes(mime) ? mime : 'image/svg+xml', base64 });
    } catch {
      setLogoErr('Could not read that file. Please choose it again.');
    }
  }

  async function saveLogo() {
    if (!pending) return;
    setLogoBusy(true);
    setLogoMsg(null);
    setLogoErr(null);
    try {
      await company.uploadLogo(pending.mime, pending.base64);
      setPending(null);
      setHasServerLogo(true);
      setLogoMsg('Logo saved. It will appear on new invoices.');
    } catch (err) {
      setLogoErr(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setLogoMsg(null);
    setLogoErr(null);
    try {
      await company.removeLogo();
      setPreview(null);
      setPending(null);
      setHasServerLogo(false);
      setLogoMsg('Logo removed. Invoices will show the company name as text.');
    } catch (err) {
      setLogoErr(err instanceof Error ? err.message : 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      // Send only the profile keys, trimmed.
      const payload: Record<string, string> = {};
      for (const k of ALL_KEYS) payload[k] = (form[k] ?? '').trim();
      await company.update(payload);
      setMsg('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Company Profile</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>
        These details appear on every invoice and quotation you send. Fill them in once.
      </p>

      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <div style={{ marginBottom: 18 }}>
        <Card title="Logo">
          <p style={{ color: 'var(--mn-subtle)', fontSize: 12, margin: '0 0 12px' }}>
            Printed at the top of the invoice. PNG, JPG or SVG, up to {Math.round(LOGO_MAX_BYTES / 1024)} KB. If you
            don’t add one, the invoice shows your company name as text.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 150, height: 60, border: '1px dashed var(--mn-border)', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                background: 'var(--mn-surface)', flex: '0 0 auto',
              }}
            >
              {preview ? (
                <img src={preview} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ color: 'var(--mn-subtle)', fontSize: 12 }}>No logo</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label
                style={{
                  display: 'inline-block', cursor: 'pointer', fontSize: 13, padding: '7px 12px',
                  border: '1px solid var(--mn-border)', borderRadius: 6, background: 'var(--mn-surface)',
                }}
              >
                {hasServerLogo || pending ? 'Choose a different file…' : 'Choose logo file…'}
                <input type="file" accept={LOGO_ACCEPT} onChange={onPickLogo} style={{ display: 'none' }} />
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Button type="button" onClick={saveLogo} disabled={!pending || logoBusy}>
                  {logoBusy ? 'Saving…' : 'Save logo'}
                </Button>
                {(hasServerLogo || preview) && (
                  <Button type="button" variant="ghost" onClick={removeLogo} disabled={logoBusy}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
          {logoErr && <p style={{ color: 'var(--mn-danger)', fontSize: 13, margin: '12px 0 0' }}>{logoErr}</p>}
          {logoMsg && <p style={{ color: 'var(--mn-success)', fontSize: 13, margin: '12px 0 0' }}>{logoMsg}</p>}
        </Card>
      </div>

      <Form onSubmit={save}>
        <div style={{ display: 'grid', gap: 18 }}>
          {SECTIONS.map((section) => (
            <Card key={section.title} title={section.title}>
              {section.help && (
                <p style={{ color: 'var(--mn-subtle)', fontSize: 12, margin: '0 0 12px' }}>{section.help}</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {section.fields.map(([k, label, help]) => (
                  <Field key={k} label={label} help={help}>
                    <Input value={form[k] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))} />
                  </Field>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
          <Button type="submit">Save profile</Button>
          {msg && <span style={{ color: 'var(--mn-success)', fontSize: 13 }}>{msg}</span>}
        </div>
      </Form>
    </div>
  );
}
