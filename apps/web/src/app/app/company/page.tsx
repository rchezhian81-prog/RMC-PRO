'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, ImageIcon, Landmark, MapPin, Phone, Receipt, Save, Settings, Trash2, Upload } from 'lucide-react';
import { GST_STATE_NAMES } from '@rmc/shared';
import { company } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input, Select } from '../../../components/ui/Field';
import { ErrorState } from '../../../components/ui/States';

/**
 * Company — the plant's own identity, the way it reads on a tax invoice.
 *
 * The header names the company with its GSTIN and state. The main column
 * holds the profile in the sections an invoice shows (who you are, where
 * you are, how to reach you, where to pay) with one Save for all of it and
 * a note when something is unsaved; the side column holds the logo with a
 * live preview, and the e-invoicing switch with the rule explained. Same
 * layout in both skins; every colour reads the semantic tokens.
 */
const SECTIONS: Array<{ key: string; title: string; icon: React.ReactNode; help: string; fields: Array<[string, string, string?]> }> = [
  {
    key: 'identity',
    title: 'Who you are',
    icon: <Building2 size={16} aria-hidden />,
    help: 'Printed at the top of every invoice and quotation.',
    fields: [
      ['companyName', 'Trading name', 'The name customers know you by'],
      ['legalName', 'Registered legal name', 'Only if different from the trading name'],
      ['gstin', 'GSTIN', '15 characters, from the GST certificate'],
      ['pan', 'PAN'],
    ],
  },
  {
    key: 'address',
    title: 'Where you are',
    icon: <MapPin size={16} aria-hidden />,
    help: 'The plant or registered address. The state decides whether a sale carries CGST and SGST or IGST.',
    fields: [
      ['addressLine1', 'Address line 1'],
      ['addressLine2', 'Address line 2'],
      ['city', 'City'],
      ['state', 'State'],
      ['pincode', 'PIN code'],
    ],
  },
  {
    key: 'contact',
    title: 'How to reach you',
    icon: <Phone size={16} aria-hidden />,
    help: 'Printed under the address.',
    fields: [
      ['phone', 'Phone'],
      ['email', 'Email'],
      ['website', 'Website'],
    ],
  },
  {
    key: 'bank',
    title: 'Where to pay',
    icon: <Landmark size={16} aria-hidden />,
    help: 'Printed on the invoice so the customer\'s accountant can pay without asking.',
    fields: [
      ['bankName', 'Bank'],
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
  const [saved, setSaved] = useState<Record<string, string>>({});
  // Kept out of `form`, which holds text fields only.
  const [einvoiceApplicable, setEinvoiceApplicable] = useState(false);
  const [savedEinvoice, setSavedEinvoice] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          setSaved(next);
          setEinvoiceApplicable(rec.einvoiceApplicable === true);
          setSavedEinvoice(rec.einvoiceApplicable === true);
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
      setLogoErr('The logo must be a PNG, JPG or SVG image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoErr(`The logo must be ${Math.round(LOGO_MAX_BYTES / 1024)} KB or smaller.`);
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
      setLogoMsg('Logo saved. It appears on the next invoice printed.');
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
      setLogoMsg('Logo removed. Invoices show the company name as text.');
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
    setBusy(true);
    try {
      // Send only the profile keys, trimmed.
      const payload: Record<string, string> = {};
      for (const k of ALL_KEYS) payload[k] = (form[k] ?? '').trim();
      await company.update({ ...payload, einvoiceApplicable });
      setSaved(payload);
      setForm(payload);
      setSavedEinvoice(einvoiceApplicable);
      setMsg('Profile saved. The next invoice or quotation printed carries it.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const dirtyKeys = ALL_KEYS.filter((k) => (form[k] ?? '') !== (saved[k] ?? ''));
  const dirty = dirtyKeys.length > 0 || einvoiceApplicable !== savedEinvoice;
  const missing = ['companyName', 'gstin', 'addressLine1', 'state'].filter((k) => !(saved[k] ?? '').trim());
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="mn-od mn-co">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <h1>
            {saved.companyName?.trim() || 'Company'}
            <span className="mn-od-badges">
              {savedEinvoice ? <Badge tone="info">e-invoicing</Badge> : null}
              {dirty ? <Badge tone="warning">unsaved changes</Badge> : null}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who">{saved.legalName?.trim() && saved.legalName.trim() !== saved.companyName?.trim() ? saved.legalName.trim() : 'What every invoice and quotation says about you'}</span>
            <span className="mn-od-fact"><Receipt size={13} aria-hidden /> {saved.gstin?.trim() ? `GSTIN ${saved.gstin.trim()}` : 'GSTIN not set'}</span>
            <span className="mn-od-fact"><MapPin size={13} aria-hidden /> {[saved.city, saved.state].filter((x) => x?.trim()).join(', ') || 'Address not set'}</span>
          </p>
        </div>
        <div className="mn-board-tools">
          <Button icon={<Save size={14} />} onClick={() => (document.getElementById('mn-co-form') as HTMLFormElement | null)?.requestSubmit()} loading={busy} disabled={!dirty}>Save profile</Button>
          <Link href="/app/settings" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Settings size={14} />}>Settings</Button>
          </Link>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}
      {missing.length > 0 && !msg && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Receipt size={16} aria-hidden />
          <span><strong>An invoice needs {missing.length === 1 ? 'one more thing' : `${missing.length} more things`}:</strong> {missing.map((k) => ({ companyName: 'the trading name', gstin: 'the GSTIN', addressLine1: 'the address', state: 'the state' })[k]).join(', ')}. Fill them in and press Save profile.</span>
        </div>
      )}

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Form id="mn-co-form" onSubmit={save} className="mn-co-form">
            {SECTIONS.map((section) => (
              <Card key={section.key} title={<span className="mn-board-card-title">{section.icon} {section.title}</span>} actions={<span className="mn-ord-how">{section.help}</span>}>
                <div className="mn-co-fields">
                  {section.fields.map(([k, label, help]) => (
                    <Field key={k} label={label} help={help}>
                      {k === 'state' ? (
                        // Chosen, not typed. The company's state is the seller side of every
                        // CGST+SGST-vs-IGST decision, and a typo here taxed every local sale as inter-state.
                        <Select value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
                          <option value="">Choose…</option>
                          {GST_STATE_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                        </Select>
                      ) : (
                        <Input value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} inputMode={k === 'pincode' || k === 'phone' ? 'numeric' : undefined} type={k === 'email' ? 'email' : 'text'} />
                      )}
                    </Field>
                  ))}
                </div>
              </Card>
            ))}
            <div className="mn-co-foot">
              <Button type="submit" icon={<Save size={14} />} loading={busy} disabled={!dirty}>Save profile</Button>
              <span className="mn-ord-how">{dirty ? `${dirtyKeys.length || 1} ${dirtyKeys.length === 1 ? 'field' : 'fields'} changed and not saved.` : 'Nothing to save.'}</span>
            </div>
          </Form>
        </div>
        <div className="mn-od-side">
          <Card title={<span className="mn-board-card-title"><ImageIcon size={16} aria-hidden /> Logo</span>} actions={hasServerLogo ? <Badge tone="success">on invoices</Badge> : <Badge tone="neutral">none</Badge>}>
            <div className="mn-co-logo">
              <div className="mn-co-logo-box">
                {preview ? <img src={preview} alt="Company logo" /> : <span className="mn-ord-meta">No logo; the name prints as text</span>}
              </div>
              <label className="mn-im-file">
                <input type="file" accept={LOGO_ACCEPT} onChange={onPickLogo} />
                <Upload size={16} aria-hidden />
                <span>{hasServerLogo || pending ? 'Choose a different file' : 'Choose a logo file'}</span>
              </label>
              <div className="mn-se-actions">
                <Button size="sm" onClick={saveLogo} disabled={!pending} loading={logoBusy} icon={<Save size={14} />}>Save logo</Button>
                {(hasServerLogo || preview) && <Button variant="ghost" size="sm" onClick={removeLogo} disabled={logoBusy} icon={<Trash2 size={14} />}>Remove</Button>}
              </div>
              <p className="mn-ord-how mn-co-logo-hint">PNG, JPG or SVG up to {Math.round(LOGO_MAX_BYTES / 1024)} KB; a wide logo prints best.</p>
              {logoErr && <ErrorState message={logoErr} />}
              {logoMsg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{logoMsg}</span></div>}
            </div>
          </Card>
          <Card title={<span className="mn-board-card-title"><Receipt size={16} aria-hidden /> GST filing</span>} actions={savedEinvoice ? <Badge tone="info">e-invoicing on</Badge> : <Badge tone="neutral">off</Badge>}>
            <p className="mn-se-blurb">E-invoicing means getting an IRN from the government portal before a sale. It applies only above the turnover limit (₹5 crore at present); your accountant will say. Leave it off if it does not apply: the compliance report then stops asking for an IRN on every invoice.</p>
            <label className="mn-se-switch">
              <input type="checkbox" role="switch" checked={einvoiceApplicable} onChange={(e) => setEinvoiceApplicable(e.target.checked)} aria-label="E-invoicing applies to this company" />
              <span className="mn-se-switch-track" aria-hidden><span className="mn-se-switch-knob" /></span>
              <span className="mn-se-switch-text">{einvoiceApplicable ? 'E-invoicing applies to this company' : 'E-invoicing does not apply'}</span>
            </label>
            <p className="mn-ord-how mn-co-logo-hint">Saved with the profile.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
