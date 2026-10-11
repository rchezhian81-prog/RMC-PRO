'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileText, KeyRound, Pencil, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, Upload, UserCheck, UserPlus, UserX, Users, X } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, passwordProblems } from '@rmc/shared';
import { formatDate, formatDateTime } from '../../../lib/format-date';
import { planUsageApi, rolesApi, usersApi, type PlanUsage, type Row } from '../../../lib/api';
import { getSession } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input, Select } from '../../../components/ui/Field';
import { PasswordInput } from '../../../components/ui/PasswordInput';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

/**
 * Users — who can sign in, and what each of them can do.
 *
 * A status strip (active / inactive / no role) with live counts doubles as
 * the filter, a search box finds a person by employee code, name, email or
 * mobile, a pill counts the seats used against the plan, notes name the
 * people with no role and a full plan, and each user is one row: employee
 * code and name with email and mobile; the role as a select that saves as
 * it changes; when they last signed in and when they were added; the status;
 * and Edit / Password / Deactivate / Activate. The new-user form opens on
 * demand with the password rule shown; Edit opens the person's details
 * (code, gender, date of joining, address) with their photo and ID proof.
 * Same layout in both skins; every colour reads the semantic tokens.
 */

const EMPTY = { name: '', email: '', password: '', mobile: '', roleId: '', employeeCode: '', gender: '', dateOfJoining: '', address: '' };
const EMPTY_EDIT = { name: '', mobile: '', employeeCode: '', gender: '', dateOfJoining: '', address: '' };
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'active', label: 'Active', tone: 'success', hint: 'Can sign in' },
  { key: 'inactive', label: 'Inactive', tone: 'neutral', hint: 'Cannot sign in; history kept' },
  { key: 'no_role', label: 'No role', tone: 'danger', hint: 'Can sign in but can open nothing' },
];
const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];
const stateOf = (u: Row) => (u.userType === 'super_admin' ? 'active' : !u.roleId ? 'no_role' : String(u.status ?? 'active'));
const daysSince = (d: unknown) => (d ? Math.floor((Date.now() - new Date(String(d)).getTime()) / 86_400_000) : null);

/** File rules, kept in step with the server (apps/api/src/setup/logo.ts). */
const PHOTO_MAX_BYTES = 1024 * 1024;
const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
const PROOF_MAX_BYTES = 3 * 1024 * 1024;
const PROOF_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf';

/** Read a File as a base64 string with no data-URL prefix. */
function fileToBase64(file: File): Promise<{ mime: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({ mime: file.type || 'application/octet-stream', base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    };
    reader.readAsDataURL(file);
  });
}

export default function UsersPage() {
  const { confirm, prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The person being edited, their details form, and the photo shown for them.
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState(EMPTY_EDIT);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);

  const reload = useCallback(async () => {
    const [u, r] = await Promise.all([usersApi.list(), rolesApi.list()]);
    setRows(u);
    setRoles(r);
    // Seats are refreshed alongside the list, so deactivating someone visibly
    // frees one. A failure here must not blank the page — the count is guidance,
    // the server is what actually decides.
    planUsageApi.get().then(setUsage).catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  const editing = useMemo(() => (editId ? rows.find((u) => String(u.id) === editId) ?? null : null), [rows, editId]);

  // The photo is fetched with the bearer token (a plain <img src> would be
  // refused) and shown as an object URL, released when it changes.
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setPhotoUrl(null);
    if (editing?.hasPhoto) {
      usersApi.photoObjectUrl(String(editing.id))
        .then((u) => { if (cancelled) URL.revokeObjectURL(u); else { url = u; setPhotoUrl(u); } })
        .catch(() => setPhotoUrl(null));
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [editing?.id, editing?.hasPhoto, editing?.photoMime]);

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

  const problems = form.password ? passwordProblems(form.password) : [];

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!form.roleId) { setError('Pick the role; without one the person can sign in but open nothing.'); return; }
    if (problems.length) { setError(`The password must ${problems.join(', ')}.`); return; }
    setBusy(true);
    try {
      const created = await usersApi.create(form);
      setNotice(`${form.name.trim()} (${String(created.employeeCode ?? '')}) can sign in with ${form.email.trim().toLowerCase()}. Give them the password yourself; it is not sent anywhere, and they choose their own at the first sign-in.`);
      setForm(EMPTY);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the user.');
    } finally {
      setBusy(false);
    }
  }

  /** Open the details card for one person, seeded from the row. */
  function startEdit(u: Row) {
    setEditId(String(u.id));
    setEdit({
      name: String(u.name ?? ''),
      mobile: String(u.mobile ?? ''),
      employeeCode: String(u.employeeCode ?? ''),
      gender: String(u.gender ?? ''),
      dateOfJoining: String(u.dateOfJoining ?? '').slice(0, 10),
      address: String(u.address ?? ''),
    });
    setNotice(null);
    setError(null);
  }
  function closeEdit() {
    setEditId(null);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await usersApi.update(editId, edit);
      await reload();
      setNotice(`Details saved for ${edit.name.trim()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the details.');
    } finally {
      setBusy(false);
    }
  }

  /** Photo: read the chosen file, send it, and show the stored copy. */
  async function onPickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editId) return;
    setError(null);
    setNotice(null);
    if (file.size > PHOTO_MAX_BYTES) { setError(`The photo must be ${Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} MB or smaller.`); return; }
    setFileBusy(true);
    try {
      const { mime, base64 } = await fileToBase64(file);
      await usersApi.uploadPhoto(editId, mime, base64);
      await reload();
      setNotice('Photo saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the photo.');
    } finally {
      setFileBusy(false);
    }
  }
  async function removePhoto() {
    if (!editId || !editing) return;
    if (!(await confirm({ title: `Remove the photo of ${String(editing.name)}`, message: 'The stored photo is deleted. A new one can be uploaded at any time.', confirmLabel: 'Remove', danger: true }))) return;
    setFileBusy(true);
    try {
      await usersApi.removePhoto(editId);
      await reload();
      setNotice('Photo removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the photo.');
    } finally {
      setFileBusy(false);
    }
  }

  /** ID proof: an image or a PDF, kept with its file name. */
  async function onPickProof(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editId) return;
    setError(null);
    setNotice(null);
    if (file.size > PROOF_MAX_BYTES) { setError(`The ID proof must be ${Math.round(PROOF_MAX_BYTES / 1024 / 1024)} MB or smaller.`); return; }
    setFileBusy(true);
    try {
      const { mime, base64 } = await fileToBase64(file);
      await usersApi.uploadIdProof(editId, mime, base64, file.name);
      await reload();
      setNotice(`ID proof saved (${file.name}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the ID proof.');
    } finally {
      setFileBusy(false);
    }
  }
  async function removeProof() {
    if (!editId || !editing) return;
    if (!(await confirm({ title: `Remove the ID proof of ${String(editing.name)}`, message: 'The stored file is deleted. A new one can be uploaded at any time.', confirmLabel: 'Remove', danger: true }))) return;
    setFileBusy(true);
    try {
      await usersApi.removeIdProof(editId);
      await reload();
      setNotice('ID proof removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the ID proof.');
    } finally {
      setFileBusy(false);
    }
  }

  /** Change a user's role in place — the list reflects the new access at once. */
  async function changeRole(u: Row, roleId: string) {
    setError(null);
    setNotice(null);
    setSavingId(String(u.id));
    try {
      await usersApi.update(String(u.id), { roleId });
      await reload();
      const role = roles.find((r) => String(r.id) === roleId);
      setNotice(role ? `${String(u.name)} is now ${String(role.roleName)}; it applies from their next sign-in.` : `${String(u.name)} has no role now.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the role.');
    } finally {
      setSavingId(null);
    }
  }

  /** Turn a login on or off without deleting the person's history. */
  async function toggleActive(u: Row) {
    const active = String(u.status ?? '') === 'active';
    const label = String(u.name ?? u.email ?? 'this user');
    if (active && !(await confirm({
      title: `Deactivate ${label}`,
      message: 'They cannot sign in until reactivated. Everything they did stays on record, and their seat on the plan is freed.',
      confirmLabel: 'Deactivate',
      danger: true,
    }))) return;
    setError(null);
    setNotice(null);
    setSavingId(String(u.id));
    try {
      await usersApi.update(String(u.id), { status: active ? 'inactive' : 'active' });
      await reload();
      setNotice(active ? `${label} can no longer sign in.` : `${label} can sign in again.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status.');
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Set a new password for someone who has forgotten theirs. Judged by the same
   * rule the server uses, so the prompt cannot accept what the API will reject.
   */
  async function resetPassword(u: Row) {
    const label = String(u.name ?? u.email ?? 'this user');
    const pw = await prompt({
      title: `New password for ${label}`,
      message: `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number. Tell them the password yourself; it is not shown again.`,
      label: 'New password',
      type: 'password',
      confirmLabel: 'Set password',
    });
    if (pw === null) return;
    const pwProblems = passwordProblems(pw);
    if (pwProblems.length) {
      setError(`That password must ${pwProblems.join(', ')}. Nothing was changed.`);
      return;
    }
    setError(null);
    setSavingId(String(u.id));
    try {
      await usersApi.update(String(u.id), { password: pw });
      setNotice(`Password updated for ${label}. Give it to them directly; it is not stored anywhere you can read, and they choose their own at the next sign-in.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password.');
    } finally {
      setSavingId(null);
    }
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const u of rows) c.set(stateOf(u), (c.get(stateOf(u)) ?? 0) + 1);
    return c;
  }, [rows]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    let list = filter ? rows.filter((u) => stateOf(u) === filter) : rows;
    // Client-side: the list is already in hand, and a company has tens of
    // people, not thousands. Matches the code, the name, the email or the mobile.
    if (q) list = list.filter((u) => [u.employeeCode, u.name, u.email, u.mobile].some((v) => String(v ?? '').toLowerCase().includes(q)));
    return list;
  }, [rows, filter, q]);
  const noRole = counts.get('no_role') ?? 0;
  const myEmail = getSession()?.email;
  // A null limit means no plan is assigned, so nothing is capped.
  const seatLimit = usage?.users.limit ?? null;
  const seatsUsed = usage?.users.used ?? rows.filter((u) => String(u.status) === 'active').length;
  const seatsFull = seatLimit !== null && seatsUsed >= seatLimit;

  return (
    <div className="mn-ord mn-us">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Users</h1>
          <p>Everyone who signs in to the app. A person sees and does only what their role allows, so give each one the role that matches their job. Deactivate someone who leaves rather than deleting them: their history stays on record.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Users size={14} aria-hidden />
            {loaded ? (seatLimit === null ? `${seatsUsed} ${seatsUsed === 1 ? 'seat' : 'seats'} in use` : `${seatsUsed} of ${seatLimit} seats on the ${usage?.planName ?? 'current'} plan`) : 'Loading…'}
          </span>
          {!showForm && <Button icon={<UserPlus size={14} />} onClick={() => { setShowForm(true); setNotice(null); }} disabled={seatsFull} title={seatsFull ? 'No seats left on your plan' : undefined}>New user</Button>}
          <Link href="/app/roles" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ShieldCheck size={14} />}>Roles</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Status strip — counts per state; press one to filter, press again for all. The search box sits beside it. */}
      <div className="mn-board-strip mn-us-strip" role="group" aria-label="Filter by status">
        {STATES.map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button key={s.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`} data-tone={s.tone} aria-pressed={on} title={s.hint} onClick={() => setFilter(on ? '' : s.key)}>
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
        <label className="mn-cu-search mn-us-search">
          <Search size={14} aria-hidden />
          <input className="mn-input" placeholder="Search by code, name, email or mobile" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users by employee code, name, email or mobile" />
        </label>
      </div>

      {loaded && (noRole > 0 || seatsFull) && !filter && (
        <div className="mn-ord-notes">
          {noRole > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter('no_role')}>
              <AlertTriangle size={16} aria-hidden />
              <span><strong>{noRole} {noRole === 1 ? 'person has' : 'people have'} no role,</strong> so they can sign in but open nothing. Pick a role on their row.</span>
            </button>
          )}
          {seatsFull && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <Users size={16} aria-hidden />
              <span><strong>All {seatLimit} seats on the {usage?.planName ?? 'current'} plan are in use.</strong> Deactivate someone who has left to free a seat, or contact Mix Nova to add more.</span>
            </div>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {notice && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{notice}</span></div>}

      {showForm && (
        <Card
          title={<span className="mn-board-card-title"><UserPlus size={16} aria-hidden /> New user</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={create} className="mn-us-form">
            <Field label="Name" required>
              <Input value={form.name} placeholder="e.g. Kavitha Raman" onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </Field>
            <Field label="Email" required help="This is what they sign in with.">
              <Input type="email" value={form.email} placeholder="name@company.in" onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Mobile">
              <Input value={form.mobile} inputMode="tel" placeholder="10 digits" onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </Field>
            <Field label="Employee code" help="Leave blank and Mix Nova numbers it (EMP-0001). Set the prefix under Setup → Number Series.">
              <Input value={form.employeeCode} placeholder="Auto" onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} />
            </Field>
            <Field label="Gender">
              <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option>
                {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </Field>
            <Field label="Date of joining">
              <Input type="date" value={form.dateOfJoining} onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })} />
            </Field>
            <Field label="Address">
              <Input value={form.address} placeholder="Street, area, city" onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="Role" required help="Decides which screens they can open.">
              <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} required>
                <option value="">Choose…</option>
                {roles.map((r) => <option key={String(r.id)} value={String(r.id)}>{String(r.roleName ?? r.roleKey ?? '')}</option>)}
              </Select>
            </Field>
            <Field label="First password" required help={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number. They are asked to choose their own the first time they sign in.`} error={form.password && problems.length ? `Must ${problems.join(', ')}.` : undefined}>
              <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </Field>
            <div className="mn-us-form-submit">
              <Button type="submit" loading={busy} disabled={seatsFull} icon={<UserPlus size={14} />}>Create the user</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">Tell them the password yourself; the app does not send it. The photo and ID proof are added from Edit on their row.</span>
            </div>
          </Form>
        </Card>
      )}

      {editing && (
        <Card
          title={<span className="mn-board-card-title"><Pencil size={16} aria-hidden /> {String(editing.name ?? '')} <span className="mn-pp-sub">· {String(editing.employeeCode ?? 'no code')}</span></span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={closeEdit}>Close</Button>}
        >
          <Form onSubmit={saveEdit} className="mn-us-form">
            <Field label="Name" required>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            </Field>
            <Field label="Mobile">
              <Input value={edit.mobile} inputMode="tel" placeholder="10 digits" onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} />
            </Field>
            <Field label="Employee code" help="Must be unique within the company.">
              <Input value={edit.employeeCode} onChange={(e) => setEdit({ ...edit, employeeCode: e.target.value })} />
            </Field>
            <Field label="Gender">
              <Select value={edit.gender} onChange={(e) => setEdit({ ...edit, gender: e.target.value })}>
                <option value="">—</option>
                {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </Field>
            <Field label="Date of joining">
              <Input type="date" value={edit.dateOfJoining} onChange={(e) => setEdit({ ...edit, dateOfJoining: e.target.value })} />
            </Field>
            <Field label="Address">
              <Input value={edit.address} placeholder="Street, area, city" onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            <div className="mn-us-form-submit">
              <Button type="submit" loading={busy} icon={<Save size={14} />}>Save details</Button>
              <span className="mn-ord-how">The email and the role are changed on the row; the password with the Password button.</span>
            </div>
          </Form>

          <div className="mn-us-files">
            <div className="mn-us-file">
              <h3 className="mn-ld-h">Photo</h3>
              <div className="mn-us-file-row">
                <div className="mn-us-thumb" aria-hidden={!photoUrl}>
                  {photoUrl ? <img src={photoUrl} alt={`Photo of ${String(editing.name ?? '')}`} /> : <span className="mn-ord-meta">{editing.hasPhoto ? 'Loading…' : 'No photo'}</span>}
                </div>
                <div className="mn-us-file-acts">
                  <label className="mn-im-file">
                    <input type="file" accept={PHOTO_ACCEPT} onChange={onPickPhoto} disabled={fileBusy} />
                    <Upload size={16} aria-hidden />
                    <span>{editing.hasPhoto ? 'Choose a different photo' : 'Choose a photo'}</span>
                  </label>
                  {editing.hasPhoto ? <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={removePhoto} disabled={fileBusy}>Remove</Button> : null}
                </div>
              </div>
              <p className="mn-ord-how mn-co-logo-hint">PNG, JPG or WebP up to {Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} MB. Saved as soon as it is chosen.</p>
            </div>
            <div className="mn-us-file">
              <h3 className="mn-ld-h">ID proof</h3>
              <div className="mn-us-file-row">
                <div className="mn-us-file-name">
                  <FileText size={16} aria-hidden />
                  {editing.idProofName ? (
                    <button type="button" className="mn-ord-link mn-us-file-open" onClick={() => usersApi.openIdProof(String(editing.id), String(editing.idProofName)).catch((e) => setError(String(e)))}>{String(editing.idProofName)}</button>
                  ) : (
                    <span className="mn-ord-meta">No ID proof on file</span>
                  )}
                </div>
                <div className="mn-us-file-acts">
                  <label className="mn-im-file">
                    <input type="file" accept={PROOF_ACCEPT} onChange={onPickProof} disabled={fileBusy} />
                    <Upload size={16} aria-hidden />
                    <span>{editing.idProofName ? 'Choose a different file' : 'Choose a file'}</span>
                  </label>
                  {editing.idProofName ? <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={removeProof} disabled={fileBusy}>Remove</Button> : null}
                </div>
              </div>
              <p className="mn-ord-how mn-co-logo-hint">Aadhaar, PAN or licence as a PNG, JPG, WebP or PDF up to {Math.round(PROOF_MAX_BYTES / 1024 / 1024)} MB. Saved as soon as it is chosen; only people who manage users can open it.</p>
            </div>
          </div>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Users size={16} aria-hidden /> People <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">A role change applies from the person's next sign-in.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Person</span>
              <span>Role</span>
              <span>Last signed in</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((u) => {
              const isSuper = u.userType === 'super_admin';
              const state = stateOf(u);
              const active = String(u.status ?? '') === 'active';
              const since = daysSince(u.lastLoginAt);
              const me = String(u.email ?? '') === myEmail;
              const on = editId === String(u.id);
              return (
                <div key={String(u.id)} className={`mn-ord-row mn-ord-row--acts mn-us-row${!active ? ' is-void' : ''}${on ? ' is-on' : ''}`} data-tone={state === 'no_role' ? 'danger' : active ? 'success' : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(u.name ?? '')}{me ? <span className="mn-ord-meta"> · you</span> : null}</span>
                    <span className="mn-ord-meta">{[u.employeeCode, u.email, u.mobile].filter(Boolean).map(String).join(' · ')}</span>
                  </div>
                  <div className="mn-us-role">
                    {isSuper ? (
                      <Badge tone="info">Platform admin</Badge>
                    ) : (
                      <Select value={String(u.roleId ?? '')} disabled={savingId === String(u.id)} onChange={(e) => changeRole(u, e.target.value)} aria-label={`Role for ${String(u.name ?? '')}`}>
                        <option value="">No role</option>
                        {roles.map((role) => <option key={String(role.id)} value={String(role.id)}>{String(role.roleName ?? role.roleKey ?? '')}</option>)}
                      </Select>
                    )}
                    {state === 'no_role' && <span className="mn-ord-meta mn-id-bad">Cannot open any screen until a role is picked</span>}
                  </div>
                  <div className="mn-us-seen">
                    <span>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</span>
                    <span className="mn-ord-meta">{since !== null ? (since === 0 ? 'today' : since === 1 ? 'yesterday' : `${since} days ago`) : `added ${formatDate(u.createdAt)}`}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={String(u.status ?? '')} /></div>
                  <div className="mn-ord-act mn-us-acts">
                    {!isSuper && (
                      <>
                        <Button variant={on ? 'secondary' : 'ghost'} size="sm" icon={<Pencil size={14} />} disabled={savingId === String(u.id)} onClick={() => (on ? closeEdit() : startEdit(u))} title="Edit the person's details, photo and ID proof">{on ? 'Close' : 'Edit'}</Button>
                        <Button variant="ghost" size="sm" icon={<KeyRound size={14} />} disabled={savingId === String(u.id)} onClick={() => resetPassword(u)} title="Set a new password for this person">Password</Button>
                        {!me && (
                          <Button variant={active ? 'ghost' : 'secondary'} size="sm" icon={active ? <UserX size={14} /> : <UserCheck size={14} />} disabled={savingId === String(u.id)} onClick={() => toggleActive(u)}>
                            {active ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={q ? `Nobody matches "${query.trim()}"` : filter ? `Nobody ${STATES.find((s) => s.key === filter)?.label.toLowerCase()}` : 'No users yet'}
            description={q ? 'Try part of the employee code, the name, the email or the mobile.' : filter ? 'Press the chip again to see everyone.' : 'Press New user to add the first person: their name, email, a first password and the role that matches their job.'}
            action={q || filter ? <Button variant="secondary" size="sm" onClick={() => { setFilter(''); setQuery(''); }}>Show all</Button> : <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New user</Button>}
          />
        )}
      </Card>
    </div>
  );
}
