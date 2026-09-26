'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { settings, gstCredentialsApi, gstApi, opsApi, whatsappIntegrationApi, gpsApi, type SettingRow, type GstCredentialStatus, type GstStatus, type AlertingStatus, type WhatsAppStatus, type GpsIngestKeyStatus } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { Form } from '../../../components/ui/Form';
import { Table, Th, Td } from '../../../components/ui/Table';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { ErrorState, Loading } from '../../../components/ui/States';

export default function SettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const list = await settings.list();
    setRows(list);
    setDraft(Object.fromEntries(list.map((r) => [r.key, r.value])));
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function save(key: string) {
    setError(null);
    setSavedKey(null);
    try {
      await settings.set(key, draft[key] ?? '');
      setSavedKey(key);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!loaded) return <Loading label="Loading settings…" />;

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Tenant Settings</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Configuration for this company. Each setting is typed and validated.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Settings">
        <div style={{ display: 'grid', gap: 18 }}>
          {rows.map((r) => {
            const v = draft[r.key] ?? '';
            const dirty = v !== r.value;
            return (
              <div key={r.key} style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 14, fontWeight: 600 }}>{r.label}</label>
                  <span style={{ fontSize: 11, color: 'var(--mn-subtle)', fontFamily: 'var(--mn-font-mono, monospace)' }}>{r.key}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--mn-muted)' }}>{r.description}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.type === 'boolean' ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={v === 'true'}
                        onChange={(e) => setDraft((p) => ({ ...p, [r.key]: String(e.target.checked) }))}
                        style={{ width: 16, height: 16, accentColor: 'var(--mn-primary)' }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>{v === 'true' ? 'On' : 'Off'}</span>
                    </label>
                  ) : r.type === 'enum' ? (
                    <select
                      className="mn-input"
                      style={{ maxWidth: 280 }}
                      value={v}
                      onChange={(e) => setDraft((p) => ({ ...p, [r.key]: e.target.value }))}
                    >
                      {(r.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={r.type === 'number' ? 'number' : 'text'}
                      style={{ maxWidth: 280 }}
                      value={v}
                      onChange={(e) => setDraft((p) => ({ ...p, [r.key]: e.target.value }))}
                    />
                  )}
                  <Button variant="secondary" size="sm" onClick={() => save(r.key)} disabled={!dirty}>Save</Button>
                  {savedKey === r.key && !dirty && (
                    <span style={{ fontSize: 12, color: 'var(--mn-success)' }}>Saved</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <GstCredentialsCard />
      <WhatsAppCard />
      <GpsFeedCard />
      <AlertingCard />
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
        ? `Test alert delivered (HTTP ${r.status ?? 200}). Check the channel — the message reads "${r.message}".`
        : `Not delivered: ${r.error ?? 'unknown reason'}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Error alerts">
      <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 10px' }}>
        When the server fails a request, the health monitor sees the site down, or a backup does not leave the box, a message goes to your alert channel.
      </p>
      {status === undefined ? (
        <p style={{ fontSize: 13, margin: 0 }}>Checking…</p>
      ) : status.configured ? (
        <>
          <p style={{ fontSize: 13, margin: '0 0 10px' }}>
            <strong style={{ color: 'var(--mn-success)' }}>Wired</strong> on this server (via {status.source ?? 'the env file'}).
            {status.digestEnabled ? ' A daily digest of dashboard alerts is on too.' : ''}
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={sendTest} disabled={busy}>{busy ? 'Sending…' : 'Send test alert'}</Button>
            {msg && <span style={{ fontSize: 12.5, color: msg.startsWith('Test alert delivered') ? 'var(--mn-success)' : 'var(--mn-danger)' }}>{msg}</span>}
          </div>
        </>
      ) : (
        <p style={{ fontSize: 13, margin: 0 }}>
          <strong style={{ color: 'var(--mn-warning)' }}>Not wired.</strong> Alerts only reach the server log. To turn them on, set RMC_ALERT_WEBHOOK in the server's .env.production, restart the api, and run scripts/ops/alert-test.sh on the server.
        </p>
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
    }, 'Credentials saved');
  }

  const testLabel = (c: GstCredentialStatus) =>
    c.lastTestSuccess === true ? 'Connected' : c.lastTestSuccess === false ? 'Failed' : 'Not tested';

  if (unavailable) return null;

  return (
    <Card title="GST portal credentials">
      <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px', maxWidth: 700 }}>
        Your GSTIN portal login, used to file e-invoices (IRN) and e-way bills live. The password is encrypted and never shown again — re-enter it to change.
      </p>
      {gstLive !== undefined && (
        <p style={{ fontSize: 12.5, margin: '0 0 12px' }}>
          Live filing on this server: {gstLive?.configured
            ? <strong style={{ color: 'var(--mn-success)' }}>enabled ({String(gstLive.provider)})</strong>
            : <><strong style={{ color: 'var(--mn-warning)' }}>not enabled</strong> — invoices are prepared but not filed with the portal. It is switched on from the server (scripts/ops/gst-enable.sh) once your GSP sandbox credentials are in hand.</>}
        </p>
      )}
      {err && <div style={{ marginBottom: 12 }}><ErrorState message={err} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '8px 12px', fontSize: 13, margin: '0 0 12px' }}>{msg}</p>
      )}

      <Table>
        <thead>
          <tr>
            <Th>GSTIN</Th>
            <Th>Connection</Th>
            <Th>Last test</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {creds.map((c) => (
            <tr key={c.gstin}>
              <Td style={{ fontWeight: 600 }}>{c.gstin}</Td>
              <Td style={{ color: c.lastTestSuccess === false ? 'var(--mn-danger)' : c.lastTestSuccess === true ? 'var(--mn-success)' : 'var(--mn-muted)' }}>
                {testLabel(c)}
                {c.lastTestMessage ? <span style={{ color: 'var(--mn-muted)', fontSize: 11, display: 'block' }}>{c.lastTestMessage}</span> : null}
              </Td>
              <Td style={{ color: 'var(--mn-muted)', fontSize: 12 }}>{c.lastTestedAt ? String(c.lastTestedAt).slice(0, 16).replace('T', ' ') : '—'}</Td>
              <Td style={{ textAlign: 'right' }}>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <Button variant="secondary" size="sm" onClick={() => run(() => gstCredentialsApi.test(c.gstin), 'Connection tested')}>Test</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        if (!(await confirm({ title: 'Remove credentials', message: `Delete the stored portal login for ${c.gstin}?`, confirmLabel: 'Remove', danger: true }))) return;
                        await gstCredentialsApi.remove(c.gstin);
                      }, 'Credentials removed')
                    }
                  >
                    Remove
                  </Button>
                </span>
              </Td>
            </tr>
          ))}
          {!creds.length && (
            <tr><Td colSpan={4} style={{ color: 'var(--mn-muted)' }}>No GST credentials configured yet.</Td></tr>
          )}
        </tbody>
      </Table>

      <Form onSubmit={add} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginTop: 14 }}>
        <div style={{ minWidth: 190 }}>
          <Field label="GSTIN" required>
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="33ABCDE1234F1Z7" required />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label="Portal username" required>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label="Portal password" required>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </Field>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Button type="submit" variant="secondary">Save credentials</Button>
        </div>
      </Form>
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
