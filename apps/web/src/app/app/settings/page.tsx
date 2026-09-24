'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BellRing, Building2, CheckCircle2, Landmark, RefreshCw, Save, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '../../../lib/format-date';
import { settings, gstCredentialsApi, gstApi, opsApi, type SettingRow, type GstCredentialStatus, type GstStatus, type AlertingStatus } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Field, Input, Select } from '../../../components/ui/Field';
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
            <Input type="password" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
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
