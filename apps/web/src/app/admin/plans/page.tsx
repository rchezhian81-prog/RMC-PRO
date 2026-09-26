'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Package, Plus, RefreshCw, Pencil } from 'lucide-react';
import { api, type ModuleRow, type PlanRow } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { money } from '../../../lib/money';

/**
 * Plans — what a company is sold, on the document-list bones.
 *
 * One row per plan: name and code, the price a month and a year, the caps
 * (plants and logins), the modules it includes against the whole catalogue,
 * how many companies are on it, and whether it can still be assigned. The
 * form opens in a card for a new plan or an edit; the modules are chips that
 * toggle, grouped as the catalogue lists them.
 */
const EMPTY = { code: '', name: '', price: '0', yearly: '', maxPlants: '', maxUsers: '', active: true };

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [catalog, setCatalog] = useState<ModuleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function resetForm() {
    setEditId(null);
    setForm(EMPTY);
    setSelected(new Set());
    setShowForm(false);
  }

  async function startEdit(id: string) {
    setError(null);
    try {
      const p = await api.getPlan(id);
      setEditId(p.id);
      setForm({
        code: p.code,
        name: p.name,
        price: String(p.monthlyPrice ?? 0),
        yearly: p.yearlyPrice ? String(p.yearlyPrice) : '',
        maxPlants: String(p.maxPlants ?? ''),
        maxUsers: String(p.maxUsers ?? ''),
        active: p.isActive,
      });
      setSelected(new Set(p.modules));
      setShowForm(true);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(String(e));
    }
  }

  async function reload() {
    const [p, c] = await Promise.all([api.plans(), api.modules()]);
    setPlans(p);
    setCatalog(c);
    setLoaded(true);
  }
  useEffect(() => {
    reload().catch((e) => { setError(String(e)); setLoaded(true); });
  }, []);

  function toggleModule(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // Caps are optional: send only when filled so the server keeps its own
      // defaults (plants→1, users→5) rather than us forcing a value.
      const caps = {
        ...(form.yearly.trim() ? { yearlyPrice: Number(form.yearly) || 0 } : {}),
        ...(form.maxPlants.trim() ? { maxPlants: Number(form.maxPlants) } : {}),
        ...(form.maxUsers.trim() ? { maxUsers: Number(form.maxUsers) } : {}),
      };
      if (editId) {
        // Code is the plan's immutable key, so it is not sent on edit.
        await api.updatePlan(editId, { planName: form.name.trim(), monthlyPrice: Number(form.price) || 0, isActive: form.active, ...caps });
        await api.setPlanModules(editId, [...selected]);
        setNotice(`${form.name.trim()} saved. Companies already on it keep their modules until the plan is applied to them again.`);
      } else {
        const plan = await api.createPlan({ planCode: form.code.trim().toLowerCase(), planName: form.name.trim(), monthlyPrice: Number(form.price) || 0, ...caps });
        if (selected.size) await api.setPlanModules(plan.id, [...selected]);
        setNotice(`${form.name.trim()} is ready to assign.`);
      }
      resetForm();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the plan.');
    } finally {
      setBusy(false);
    }
  }

  const onPlans = plans.reduce((n, p) => n + (p.tenantCount ?? 0), 0);

  return (
    <div className="mn-ord mn-pl">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Plans</h1>
          <p>What a company is sold: the modules it can open, how many plants and logins it may have, and the price. Applying a plan to a company sets its modules to the plan's; a plan with companies on it is one to edit with care.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum"><Package size={14} aria-hidden /> {plans.length} {plans.length === 1 ? 'plan' : 'plans'} · {onPlans} {onPlans === 1 ? 'company' : 'companies'} on one</span>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => { if (showForm && !editId) resetForm(); else { setEditId(null); setForm(EMPTY); setSelected(new Set()); setShowForm(true); } }} aria-expanded={showForm && !editId}>New plan</Button>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => reload().catch((e) => setError(String(e)))}>Refresh</Button>
        </div>
      </header>

      {(notice || error) && (
        <div className="mn-ord-notes">
          {notice && <div className="mn-ord-note mn-ord-note--ok" role="status"><Package size={16} aria-hidden /><span>{notice}</span></div>}
          {error && <ErrorState message={error} />}
        </div>
      )}

      {showForm && (
        <Card title={<span className="mn-board-card-title">{editId ? <Pencil size={16} aria-hidden /> : <Plus size={16} aria-hidden />} {editId ? `Edit plan · ${form.code}` : 'New plan'}</span>}>
          <Form onSubmit={submit} className="mn-pl-form">
            <div className="mn-pl-fields">
              <Field label="Code" required help={editId ? 'Fixed once created.' : 'Short, lowercase; it never changes. e.g. starter'}>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required disabled={!!editId} autoCapitalize="none" spellCheck={false} autoFocus={!editId} />
              </Field>
              <Field label="Name" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus={!!editId} />
              </Field>
              <Field label="Price a month (₹)">
                <Input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </Field>
              <Field label="Price a year (₹)" help="Blank if there is no yearly price.">
                <Input type="number" min={0} value={form.yearly} onChange={(e) => setForm({ ...form, yearly: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Plants allowed" help="Blank means 1.">
                <Input type="number" min={1} value={form.maxPlants} onChange={(e) => setForm({ ...form, maxPlants: e.target.value })} placeholder="1" />
              </Field>
              <Field label="Logins allowed" help="Blank means 5. Deactivated logins do not count.">
                <Input type="number" min={1} value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} placeholder="5" />
              </Field>
            </div>
            <div className="mn-pl-mods-head">
              <span className="mn-ord-how">Modules included · {selected.size} of {catalog.length}</span>
              <span className="mn-pl-mods-acts">
                <button type="button" className="mn-id-link" onClick={() => setSelected(new Set(catalog.map((m) => m.moduleKey)))}>All</button>
                <button type="button" className="mn-id-link" onClick={() => setSelected(new Set())}>None</button>
              </span>
            </div>
            <div className="mn-pl-mods" role="group" aria-label="Modules included">
              {catalog.map((m) => {
                const on = selected.has(m.moduleKey);
                return (
                  <label key={m.moduleKey} className={`mn-board-chip mn-pl-mod${on ? ' is-on' : ''}`} data-tone="info">
                    <input type="checkbox" checked={on} onChange={() => toggleModule(m.moduleKey)} />
                    <span className="mn-board-chip-l">{m.name}</span>
                    <span className="mn-ord-meta">P{m.phase}</span>
                  </label>
                );
              })}
            </div>
            <div className="mn-pl-form-submit">
              {editId && (
                <label className="mn-se-switch">
                  <input type="checkbox" role="switch" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  <span className="mn-se-switch-track" aria-hidden><span className="mn-se-switch-knob" /></span>
                  <span className="mn-se-switch-text">{form.active ? 'Can be assigned' : 'Retired: cannot be assigned to new companies'}</span>
                </label>
              )}
              <Button type="submit" loading={busy} icon={editId ? <Pencil size={14} /> : <Plus size={14} />}>{editId ? 'Save the plan' : 'Create the plan'}</Button>
              <Button type="button" variant="secondary" onClick={resetForm}>Cancel</Button>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Package size={16} aria-hidden /> Plans <span className="mn-board-card-count">{plans.length}</span></span>}
        actions={<span className="mn-ord-how">Sorted by code. Modules are counted against the {catalog.length} in the catalogue.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : plans.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Plan</span>
              <span>Price</span>
              <span>Allows</span>
              <span>Modules</span>
              <span>Companies</span>
              <span>Status</span>
              <span />
            </div>
            {plans.map((p) => (
              <div key={p.id} className={`mn-ord-row mn-ord-row--acts${p.isActive === false ? ' is-void' : ''}${editId === p.id ? ' is-editing' : ''}`} data-tone={p.isActive === false ? 'neutral' : 'info'} role="listitem">
                <div className="mn-ord-id">
                  <span className="mn-ord-no">{p.name}</span>
                  <span className="mn-ord-meta">{p.code}</span>
                </div>
                <div className="mn-ord-who mn-pl-price">
                  <span className="mn-ord-cust">{money(p.monthlyPrice)} a month</span>
                  <span className="mn-ord-meta">{p.yearlyPrice ? `${money(p.yearlyPrice)} a year` : 'no yearly price'}</span>
                </div>
                <div className="mn-ord-who mn-pl-caps">
                  <span className="mn-ord-cust">{p.maxPlants} {p.maxPlants === 1 ? 'plant' : 'plants'}</span>
                  <span className="mn-ord-meta">{p.maxUsers} {p.maxUsers === 1 ? 'login' : 'logins'}</span>
                </div>
                <div className="mn-ord-val mn-pl-mods-n"><span className="mn-ord-amt">{p.moduleCount}</span><span className="mn-ord-meta">of {catalog.length}</span></div>
                <div className="mn-ord-val mn-pl-tenants"><span className="mn-ord-amt">{p.tenantCount ?? 0}</span><span className="mn-ord-meta">{(p.tenantCount ?? 0) === 1 ? 'company' : 'companies'}</span></div>
                <div className="mn-ord-status">{p.isActive === false ? <Badge tone="neutral">retired</Badge> : <Badge tone="success">assignable</Badge>}</div>
                <div className="mn-ord-act"><Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => startEdit(p.id)}>Edit</Button></div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No plans yet" description="Press New plan to create the first one; a company can be created without one and given a plan later." />
        )}
      </Card>
    </div>
  );
}
