'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BellRing, Building2, CheckCircle2, Landmark, RefreshCw, Save, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '../../../lib/format-date';
import { settings, gstCredentialsApi, gstApi, opsApi, whatsappIntegrationApi, gpsApi, type SettingRow, type GstCredentialStatus, type GstStatus, type AlertingStatus, type WhatsAppStatus, type GpsIngestKeyStatus } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Field, Input, Select } from '../../../components/ui/Field';
import { PasswordInput } from '../../../components/ui/PasswordInput';
import { Form } from '../../../components/ui/Form';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { ErrorState, TableSkeleton } from '../../../components/ui/States';

/**
 * Settings — the handful of switches that change how the app behaves.
 *
 * Each setting is one row: the name, what it does in plain words, and the
 * control (a switch, a choice, a number or text) with Save beside it that
 * lights up only when the value changed. Below, the GST portal logins and
 * the error-alert wiring, each in its own card with plain status words.
 * Same layout in both skins; every colour reads the semantic tokens.
 */

/** The catalogue's descriptions, said the way an owner would say them. */
const PLAIN: Record<string, string> = {
  credit_block_stage: 'When a customer over their credit limit gets stopped: when the order is booked, only when the truck is about to leave, or never.',
  default_gst_rate: 'The GST rate a new quotation or order line starts with. Concrete is usually 18%.',
  default_credit_days: 'The credit period a new customer starts with; change it per customer afterwards.',
  low_stock_alerts: 'Show an alert on the dashboard when a material drops below its reorder level.',
  whatsapp_notifications: 'Offer WhatsApp sends for receipts and dispatches.',
  invoice_footer_note: 'A line printed at the foot of every tax invoice: bank terms, a thank-you, a notice.',
};

export default function SettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const list = await settings.list();
    setRows(list);
    setDraft(Object.fromEntries(list.map((r) => [r.key, r.value])));
  }, []);
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function save(key: string) {
    setError(null);
    setSavedKey(null);
    setSavingKey(key);
    try {
      await settings.set(key, draft[key] ?? '');
      setSavedKey(key);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }

  const changed = rows.filter((r) => (draft[r.key] ?? '') !== r.value).length;

  return (
    <div className="mn-ord mn-se">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Settings</h1>
          <p>The switches that change how the app behaves for this company: when credit stops an order, the defaults a new customer or line starts with, and what is printed or sent. The company name, address and bank details live under <Link href="/app/company" prefetch={false} className="mn-id-link">Company</Link>.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <SettingsIcon size={14} aria-hidden />
            {loaded ? `${rows.length} settings${changed ? ` · ${changed} unsaved` : ''}` : 'Loading…'}
          </span>
          <Link href="/app/company" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Building2 size={14} />}>Company</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}

      <Card title={<span className="mn-board-card-title"><SettingsIcon size={16} aria-hidden /> How the app behaves <span className="mn-board-card-count">{rows.length}</span></span>} actions={<span className="mn-ord-how">Each setting saves on its own; Save lights up when the value changed.</span>} padded={false}>
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={3} /></div>
        ) : (
          <div className="mn-se-list">
            {rows.map((r) => {
              const v = draft[r.key] ?? '';
              const dirty = v !== r.value;
              const set = (val: string) => setDraft((p) => ({ ...p, [r.key]: val }));
              return (
                <div key={r.key} className={`mn-se-row${dirty ? ' is-dirty' : ''}`}>
                  <div className="mn-se-text">
                    <span className="mn-se-label">{r.label}</span>
                    <span className="mn-ord-meta">{PLAIN[r.key] ?? r.description}</span>
                  </div>
                  <div className="mn-se-control">
                    {r.type === 'boolean' ? (
                      <label className="mn-se-switch">
                        <input type="checkbox" role="switch" checked={v === 'true'} onChange={(e) => set(String(e.target.checked))} aria-label={r.label} />
                        <span className="mn-se-switch-track" aria-hidden><span className="mn-se-switch-knob" /></span>
                        <span className="mn-se-switch-text">{v === 'true' ? 'On' : 'Off'}</span>
                      </label>
                    ) : r.type === 'enum' ? (
                      <Select value={v} onChange={(e) => set(e.target.value)} aria-label={r.label}>
                        {(r.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    ) : (
                      <Input type={r.type === 'number' ? 'number' : 'text'} inputMode={r.type === 'number' ? 'decimal' : undefined} value={v} onChange={(e) => set(e.target.value)} aria-label={r.label} placeholder={r.type === 'string' ? 'Nothing printed' : undefined} />
                    )}
                  </div>
                  <div className="mn-se-save">
                    <Button variant={dirty ? undefined : 'ghost'} size="sm" icon={<Save size={14} />} onClick={() => save(r.key)} disabled={!dirty} loading={savingKey === r.key}>Save</Button>
                    {savedKey === r.key && !dirty && <span className="mn-ord-meta mn-se-saved"><CheckCircle2 size={13} aria-hidden /> Saved</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="mn-ir-two">
        <GstCredentialsCard />
        <AlertingCard />
      </div>
      <div className="mn-ir-two">
        <WhatsAppCard />
        <GpsFeedCard />
      </div>
    </div>
  );
}

/**
 * Whether the server pages someone when it fails — and a button to prove it.
 * The webhook lives in the server's env file (RMC_ALERT_WEBHOOK), never here;
 * this card only reads whether one is wired and sends a test through it.
 */
function AlertingCard() {
  const [status, setStatus] = useState<AlertingStatus | null | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    opsApi.alerting().then(setStatus).catch(() => setStatus(null));
  }, []);
  if (status === null) return null; // not permitted → nothing to show
  async function sendTest() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await opsApi.alertTest();
      setMsg(r.delivered
        ? `Test alert delivered (HTTP ${r.status ?? 200}). Check the channel; the message reads "${r.message}".`
        : `Not delivered: ${r.error ?? 'unknown reason'}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={<span className="mn-board-card-title"><BellRing size={16} aria-hidden /> Error alerts</span>} actions={status === undefined ? null : status.configured ? <Badge tone="success">wired</Badge> : <Badge tone="warning">not wired</Badge>}>
      <p className="mn-se-blurb">When the server fails a request, the health monitor sees the site down, or a backup does not leave the box, a message goes to your alert channel.</p>
      {status === undefined ? (
        <p className="mn-ord-meta">Checking…</p>
      ) : status.configured ? (
        <>
          <p className="mn-se-blurb"><strong>Wired</strong> on this server via {status.source ?? 'the env file'}.{status.digestEnabled ? ' A daily digest of dashboard alerts is on too.' : ''}</p>
          <div className="mn-se-actions">
            <Button variant="secondary" size="sm" onClick={sendTest} loading={busy}>Send a test alert</Button>
            {msg && <span className={`mn-ord-meta${msg.startsWith('Test alert delivered') ? ' mn-st-in' : ' mn-id-bad'}`}>{msg}</span>}
          </div>
        </>
      ) : (
        <p className="mn-se-blurb"><strong>Not wired.</strong> Alerts only reach the server log. To turn them on, set <code>RMC_ALERT_WEBHOOK</code> in the server's .env.production, restart the API, and run scripts/ops/alert-test.sh on the server.</p>
      )}
    </Card>
  );
}

/**
 * Manage the tenant's GST-portal logins (per GSTIN) so live e-invoice / e-way
 * filing can authenticate. The server returns REDACTED status only — passwords
 * are encrypted and never come back. Hidden when the billing module is off or
 * the user lacks settings.manage (the list call 403s).
 */
function GstCredentialsCard() {
  const { confirm } = useConfirm();
  const [creds, setCreds] = useState<GstCredentialStatus[]>([]);
  const [gstLive, setGstLive] = useState<GstStatus | null | undefined>(undefined);
  useEffect(() => {
    // Best-effort: 403 for users without the agents permissions → say nothing.
    gstApi.status().then(setGstLive).catch(() => setGstLive(undefined));
  }, []);
  const [form, setForm] = useState({ gstin: '', username: '', password: '' });
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function reload() {
    try {
      setCreds(await gstCredentialsApi.list());
    } catch {
      setUnavailable(true);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await gstCredentialsApi.set(form.gstin.trim().toUpperCase(), form.username.trim(), form.password);
      setForm({ gstin: '', username: '', password: '' });
      setShowForm(false);
    }, 'Portal login saved. Press Test to check it connects.');
  }

  if (unavailable) return null;

  return (
    <Card title={<span className="mn-board-card-title"><Landmark size={16} aria-hidden /> GST portal logins <span className="mn-board-card-count">{creds.length}</span></span>} actions={gstLive === undefined ? null : gstLive?.configured ? <Badge tone="success">live filing on</Badge> : <Badge tone="neutral">live filing off</Badge>}>
      <p className="mn-se-blurb">Your GSTIN portal login, used to file e-invoices (IRN) and e-way bills straight from the app. The password is encrypted and never shown again; enter it again to change it.</p>
      {gstLive !== undefined && !gstLive?.configured && (
        <p className="mn-se-blurb"><strong>Live filing is not switched on</strong> on this server: invoices are prepared but not filed with the portal. It is switched on from the server (scripts/ops/gst-enable.sh) once your GSP credentials are in hand.</p>
      )}
      {err && <ErrorState message={err} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}
      {creds.length > 0 && (
        <div className="mn-se-creds">
          {creds.map((c) => (
            <div key={c.gstin} className="mn-se-cred">
              <div className="mn-se-cred-text">
                <span className="mn-ord-no">{c.gstin}</span>
                <span className="mn-ord-meta">{c.lastTestedAt ? `tested ${formatDateTime(c.lastTestedAt)}` : 'not tested yet'}{c.lastTestMessage ? ` · ${c.lastTestMessage}` : ''}</span>
              </div>
              {c.lastTestSuccess === true ? <Badge tone="success">connected</Badge> : c.lastTestSuccess === false ? <Badge tone="danger">failed</Badge> : <Badge tone="neutral">not tested</Badge>}
              <div className="mn-se-cred-acts">
                <Button variant="secondary" size="sm" onClick={() => run(() => gstCredentialsApi.test(c.gstin), 'Connection tested; see the result on the row.')}>Test</Button>
                <Button variant="ghost" size="sm" onClick={() => run(async () => {
                  if (!(await confirm({ title: `Remove the login for ${c.gstin}`, message: 'Live filing for this GSTIN stops until a login is saved again.', confirmLabel: 'Remove', danger: true }))) return;
                  await gstCredentialsApi.remove(c.gstin);
                }, 'Login removed.')}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm ? (
        <Form onSubmit={add} className="mn-se-cred-form">
          <Field label="GSTIN" required>
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="33ABCDE1234F1Z7" required />
          </Field>
          <Field label="Portal username" required>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </Field>
          <Field label="Portal password" required>
            <PasswordInput autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </Field>
          <div className="mn-se-actions">
            <Button type="submit" size="sm" icon={<ShieldCheck size={14} />}>Save the login</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Form>
      ) : (
        <div className="mn-se-actions">
          <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>{creds.length ? 'Add another GSTIN' : 'Add a portal login'}</Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Connect the company's WhatsApp Business account (Meta Cloud API) so shared
 * documents are SENT to the customer instead of only opening a chat window.
 * The token is sealed on the server and never shown again; the card shows the
 * phone-number id, where the connection comes from and the last test.
 */
function WhatsAppCard() {
  const { confirm } = useConfirm();
  const [status, setStatus] = useState<WhatsAppStatus | null | undefined>(undefined);
  const [form, setForm] = useState({ phoneNumberId: '', accessToken: '', businessNumber: '', templateName: '', templateLanguage: 'en' });
  const [testMobile, setTestMobile] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const load = () => whatsappIntegrationApi.status().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);
  if (status === null) return null; // not permitted → nothing to show

  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null); setMsg(null);
    try {
      await whatsappIntegrationApi.set({
        phoneNumberId: form.phoneNumberId.trim(), accessToken: form.accessToken.trim(), businessNumber: form.businessNumber.trim() || undefined,
        templateName: form.templateName.trim() || undefined, templateLanguage: form.templateLanguage.trim() || undefined,
      });
      setForm({ phoneNumberId: '', accessToken: '', businessNumber: '', templateName: '', templateLanguage: 'en' });
      setOpen(false);
      setMsg('WhatsApp Business connected. Send a test message below to prove it.');
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  }
  async function test() {
    setErr(null); setMsg(null);
    try {
      const r = await whatsappIntegrationApi.test(testMobile.trim());
      setMsg(r.delivered ? `Test message delivered to ${testMobile.trim()} (WhatsApp id ${r.providerMessageId ?? '—'}). Check the phone.` : `Not delivered: ${r.error ?? 'unknown reason'}`);
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  }
  async function disconnect() {
    if (!(await confirm({ title: 'Disconnect WhatsApp Business?', message: 'The stored token is deleted. Shares go back to opening a chat window.', confirmLabel: 'Disconnect', danger: true }))) return;
    setErr(null); setMsg(null);
    try { await whatsappIntegrationApi.remove(); setMsg('Disconnected.'); await load(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  }
  return (
    <Card title="WhatsApp Business (automatic sending)">
      <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 10px' }}>
        Without this, &quot;Share on WhatsApp&quot; opens a chat window for you to press Send. With a WhatsApp Business account connected, quotations, challans, invoices, receipts and credit notes are sent to the customer straight away and the send log shows delivered or failed.
        You need a Meta Business account with the WhatsApp product: copy the <strong>Phone number ID</strong> and a permanent <strong>access token</strong> from Meta (WhatsApp → API setup). A pre-approved <strong>template</strong> with one variable lets messages go out at any time; without one, Meta only delivers inside 24 hours of the customer&apos;s last message.
      </p>
      {status === undefined ? <p style={{ fontSize: 13, margin: 0 }}>Checking…</p> : (
        <>
          <p style={{ fontSize: 13, margin: '0 0 10px' }}>
            {status.configured ? (
              <>
                <strong style={{ color: 'var(--mn-success)' }}>Connected</strong> {status.source === 'server' ? 'through the server’s env file' : 'with this company’s own account'} — phone number id {status.phoneNumberId}
                {status.businessNumber ? ` (${status.businessNumber})` : ''}{status.templateName ? `, template ${status.templateName} (${status.templateLanguage})` : ', free-text messages (24-hour window)'}.
                {status.lastTestedAt ? ` Last test ${new Date(status.lastTestedAt).toLocaleString('en-IN')}: ${status.lastTestSuccess ? 'delivered' : `failed — ${status.lastTestMessage ?? ''}`}.` : ''}
              </>
            ) : (
              <><strong style={{ color: 'var(--mn-warning)' }}>Not connected.</strong> Shares open a chat window only.</>
            )}
          </p>
          {!status.encryptionAvailable && (
            <p style={{ fontSize: 12.5, color: 'var(--mn-danger)', margin: '0 0 10px' }}>
              This server has no credential key yet, so a token cannot be stored. On the server run: <code>cd /opt/rmc &amp;&amp; sudo ./scripts/ops/cred-key-ensure.sh</code>
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} disabled={!status.encryptionAvailable}>{status.source === 'tenant' ? 'Replace account' : 'Connect account'}</Button>
            {status.source === 'tenant' && <Button variant="ghost" size="sm" onClick={disconnect}>Disconnect</Button>}
          </div>
          {open && (
            <Form onSubmit={save}>
              <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
                <Field label="Phone number ID" required help="The numeric id shown under WhatsApp → API setup in Meta, not the phone number.">
                  <Input value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} required inputMode="numeric" />
                </Field>
                <Field label="Access token" required help="A permanent System User token with whatsapp_business_messaging. Stored encrypted; never shown again.">
                  <Input type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} required autoComplete="off" />
                </Field>
                <Field label="Business number (display)" help="Optional, e.g. +91 98765 43210 — shown on this card only.">
                  <Input value={form.businessNumber} onChange={(e) => setForm({ ...form, businessNumber: e.target.value })} />
                </Field>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 2, minWidth: 200 }}>
                    <Field label="Template name" help="Optional. An approved template whose body is just {{1}}; the message text goes in as the variable.">
                      <Input value={form.templateName} onChange={(e) => setForm({ ...form, templateName: e.target.value })} placeholder="e.g. rmc_notice" />
                    </Field>
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <Field label="Template language"><Input value={form.templateLanguage} onChange={(e) => setForm({ ...form, templateLanguage: e.target.value })} placeholder="en" /></Field>
                  </div>
                </div>
                <div><Button type="submit">Save connection</Button></div>
              </div>
            </Form>
          )}
          {status.configured && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 10 }}>
              <div style={{ width: 200 }}><Field label="Send a test to (mobile)"><Input value={testMobile} onChange={(e) => setTestMobile(e.target.value)} placeholder="98765 43210" /></Field></div>
              <Button variant="secondary" onClick={test} disabled={!testMobile.trim()}>Send test message</Button>
            </div>
          )}
          {msg && <p style={{ fontSize: 12.5, color: /delivered|onnected|Disconnected/.test(msg) && !/Not delivered/.test(msg) ? 'var(--mn-success)' : 'var(--mn-danger)', margin: '10px 0 0' }}>{msg}</p>}
          {err && <p style={{ fontSize: 12.5, color: 'var(--mn-danger)', margin: '10px 0 0' }}>{err}</p>}
        </>
      )}
    </Card>
  );
}

/**
 * The GPS vendor feed: a key any tracking vendor posts vehicle positions with.
 * Shown once when generated; afterwards only its last four characters.
 */
function GpsFeedCard() {
  const { confirm } = useConfirm();
  const [status, setStatus] = useState<GpsIngestKeyStatus | null | undefined>(undefined);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => gpsApi.ingestKey().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);
  if (status === null) return null;
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  const endpoint = `${apiBase}/api/v1/gps/ingest`;
  const sample = JSON.stringify([{ vehicleNo: 'TN01AB1234', latitude: 13.0827, longitude: 80.2707, speedKmph: 42, heading: 90, timestamp: '2026-01-31T10:15:00+05:30' }], null, 2);

  async function generate() {
    if (status?.configured && !(await confirm({ title: 'Issue a new key?', message: `The current key (…${status.keyHint}) stops working the moment the new one is issued. Give the new key to your GPS vendor.`, confirmLabel: 'Issue new key' }))) return;
    setErr(null); setMsg(null);
    try {
      const r = await gpsApi.createIngestKey(label.trim() || undefined);
      setFresh(r.key); setLabel('');
      setMsg('New key issued. Copy it now — it is not shown again.');
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  }
  async function revoke() {
    if (!(await confirm({ title: 'Revoke the GPS feed key?', message: 'The vendor’s posts are refused until a new key is issued.', confirmLabel: 'Revoke', danger: true }))) return;
    setErr(null); setMsg(null);
    try { await gpsApi.revokeIngestKey(); setFresh(null); setMsg('Key revoked.'); await load(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  }
  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setMsg(`${what} copied.`); } catch { setMsg(`Select and copy the ${what.toLowerCase()} by hand.`); }
  }
  return (
    <Card title="GPS vendor feed">
      <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 10px' }}>
        Any GPS tracking vendor (or your own device gateway) can post vehicle positions here; they land on Live Tracking and on the vehicle&apos;s last known position. Give the vendor the endpoint and the key below. Vehicles are matched by registration number, or by the GPS device ID (IMEI) entered under Masters → Vehicles.
      </p>
      {status === undefined ? <p style={{ fontSize: 13, margin: 0 }}>Checking…</p> : (
        <>
          <p style={{ fontSize: 13, margin: '0 0 10px' }}>
            {status.configured ? (
              <><strong style={{ color: 'var(--mn-success)' }}>Key active</strong> (…{status.keyHint}{status.label ? `, ${status.label}` : ''}), issued {status.createdAt ? new Date(status.createdAt).toLocaleDateString('en-IN') : ''}.{' '}
                {status.lastUsedAt ? `Last position received ${new Date(status.lastUsedAt).toLocaleString('en-IN')}.` : 'Nothing received yet.'}</>
            ) : (
              <><strong style={{ color: 'var(--mn-warning)' }}>No key issued.</strong> Issue one and hand it to your GPS vendor.</>
            )}
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ width: 220 }}><Field label="Label (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Vendor name" /></Field></div>
            <Button variant="secondary" onClick={generate}>{status.configured ? 'Issue new key' : 'Issue key'}</Button>
            {status.configured && <Button variant="ghost" onClick={revoke}>Revoke</Button>}
          </div>
          {fresh && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <code style={{ fontSize: 13, padding: '6px 8px', background: 'var(--mn-surface-2, rgba(0,0,0,0.05))', borderRadius: 6, wordBreak: 'break-all' }}>{fresh}</code>
              <Button size="sm" variant="secondary" onClick={() => copy(fresh, 'Key')}>Copy key</Button>
            </div>
          )}
          <div style={{ fontSize: 12.5, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>Endpoint: <code>POST {endpoint}</code></span>
              <Button size="sm" variant="ghost" onClick={() => copy(endpoint, 'Endpoint')}>Copy</Button>
            </div>
            <div>Header: <code>X-RMC-GPS-KEY: &lt;the key&gt;</code> (or <code>?key=</code> on the URL). Body: one position or a list, JSON.</div>
            <pre style={{ margin: 0, fontSize: 12, padding: 8, background: 'var(--mn-surface-2, rgba(0,0,0,0.05))', borderRadius: 6, overflowX: 'auto' }}>{sample}</pre>
            <div style={{ color: 'var(--mn-muted)' }}>Also accepted: <code>deviceId</code>/<code>imei</code> instead of <code>vehicleNo</code>; <code>lat</code>/<code>lng</code>; <code>speed</code>; epoch seconds or milliseconds for the time. Up to 500 positions per request.</div>
          </div>
          {msg && <p style={{ fontSize: 12.5, color: 'var(--mn-success)', margin: '10px 0 0' }}>{msg}</p>}
          {err && <p style={{ fontSize: 12.5, color: 'var(--mn-danger)', margin: '10px 0 0' }}>{err}</p>}
        </>
      )}
    </Card>
  );
}
