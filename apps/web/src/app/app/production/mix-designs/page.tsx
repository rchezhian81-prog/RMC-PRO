'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Copy, FlaskConical, Layers, Plus, RefreshCw, Save, Trash2, X, XCircle } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { crud, mixDesignsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Mix designs — the plant's recipes.
 *
 * A stage strip (draft / approved / retired / rejected) with live counts
 * doubles as the filter, a summary pill counts the designs and the grades
 * they cover, and each design is one tappable row: code and version with
 * the cement, the grade with its slump range, the recipe in a line
 * (materials, water-cement ratio, pumpable), how often it has been batched,
 * and its stage. Notes flag grades with no approved recipe (an order for
 * them cannot be batched) and drafts waiting for approval. The "new design"
 * form sits above the list; the open design's recipe sits below it with its
 * materials per cubic metre, an add-material form and the details form
 * while it is a draft, and Approve / Reject / New version. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'neutral', hint: 'Being written: materials and details can still change; not usable for batching' },
  { key: 'approved', label: 'Approved', tone: 'success', hint: 'The active recipe for its grade: what the plant batches' },
  { key: 'retired', label: 'Retired', tone: 'info', hint: 'An earlier approved version, replaced when a newer one was approved' },
  { key: 'rejected', label: 'Rejected', tone: 'danger', hint: 'Turned down at approval; nothing is batched from it' },
];
const toneOf = (stage: string): Tone => STAGES.find((s) => s.key === stage)?.tone ?? 'neutral';
const labelOf = (stage: string) => STAGES.find((s) => s.key === stage)?.label.toLowerCase() ?? stage;
/** Which chip a design sits under: an approved design that is no longer the active version is retired. */
const stageOf = (r: Row) => (String(r.approvalStatus) === 'approved' && r.isActiveVersion === false ? 'retired' : String(r.approvalStatus ?? 'draft'));
const slumpOf = (r: Row) => (r.slumpMin != null || r.slumpMax != null ? `${r.slumpMin != null ? String(r.slumpMin) : '?'}–${r.slumpMax != null ? String(r.slumpMax) : '?'} mm slump` : 'No slump range');

const EMPTY_FORM = { mixCode: '', gradeId: '', cementType: '', waterCementRatio: '', slumpMin: '', slumpMax: '', pumpable: false };

export default function MixDesignsPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [details, setDetails] = useState({ cementType: '', waterCementRatio: '', slumpMin: '', slumpMax: '', pumpable: false, notes: '' });
  const [mat, setMat] = useState({ materialId: '', targetQuantity: '', tolerancePercentage: '2' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [m, g, mt] = await Promise.all([mixDesignsApi.list(), crud('concrete-grades').list(), crud('materials').list()]);
    setRows(m);
    setGrades(g);
    setMaterials(mt);
  }, []);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  /** Open a design and seed the details form from it. */
  const show = useCallback((d: Row) => {
    setSel(d);
    setDetails({
      cementType: String(d.cementType ?? ''),
      waterCementRatio: d.waterCementRatio == null ? '' : String(Number(d.waterCementRatio)),
      slumpMin: d.slumpMin == null ? '' : String(d.slumpMin),
      slumpMax: d.slumpMax == null ? '' : String(d.slumpMax),
      pumpable: !!d.pumpable,
      notes: String(d.notes ?? ''),
    });
    setMat({ materialId: '', targetQuantity: '', tolerancePercentage: '2' });
  }, []);

  // Arriving with ?mix=<id> (a link from a ticket or the queue) opens that recipe straight away.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('mix');
    if (id) mixDesignsApi.get(id).then(show).catch((e) => setError(String(e)));
  }, [show]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      if (sel) show(await mixDesignsApi.get(String(sel.id)));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  /** Run an action, then refresh the list; errors surface inline. */
  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const out = await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setMsg(null);
    setError(null);
    try {
      show(await mixDesignsApi.get(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const g = grades.find((x) => String(x.id) === form.gradeId);
      const created = await mixDesignsApi.create({
        mixCode: form.mixCode.trim(),
        gradeId: form.gradeId || undefined,
        gradeLabel: g ? String(g.gradeCode) : undefined,
        cementType: form.cementType || undefined,
        waterCementRatio: form.waterCementRatio ? Number(form.waterCementRatio) : undefined,
        slumpMin: form.slumpMin ? Number(form.slumpMin) : undefined,
        slumpMax: form.slumpMax ? Number(form.slumpMax) : undefined,
        pumpable: form.pumpable,
      });
      setForm(EMPTY_FORM);
      show(await mixDesignsApi.get(String(created.id)));
      return `${String((created as Row).mixCode ?? 'Design')} created as a draft; add its materials per cubic metre below.`;
    });
  }

  /** Copy the open design into a new draft version (the way an approved recipe is changed). */
  async function newVersion() {
    if (!sel) return;
    const mats = (sel.materials as Row[]) ?? [];
    const next = num(sel.versionNo) + 1;
    await run(async () => {
      const created = await mixDesignsApi.create({
        mixCode: sel.mixCode,
        versionNo: next,
        gradeId: sel.gradeId ?? undefined,
        gradeLabel: sel.gradeCode ?? undefined,
        cementType: sel.cementType ?? undefined,
        waterCementRatio: sel.waterCementRatio == null ? undefined : Number(sel.waterCementRatio),
        slumpMin: sel.slumpMin ?? undefined,
        slumpMax: sel.slumpMax ?? undefined,
        pumpable: !!sel.pumpable,
        notes: sel.notes ?? undefined,
        plantId: sel.plantId ?? undefined,
        materials: mats.map((mm) => ({ materialId: mm.materialId, materialLabel: mm.materialLabel, targetQuantity: mm.targetQuantity, uom: mm.uom, tolerancePercentage: mm.tolerancePercentage, sequenceNo: mm.sequenceNo })),
      });
      show(await mixDesignsApi.get(String(created.id)));
      return `${String(sel.mixCode)} v${next} created as a draft with the same materials. Change what needs changing, then approve it to retire v${String(sel.versionNo)}.`;
    });
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    await run(async () => {
      show(await mixDesignsApi.update(String(sel.id), {
        cementType: details.cementType || null,
        waterCementRatio: details.waterCementRatio ? Number(details.waterCementRatio) : null,
        slumpMin: details.slumpMin ? Number(details.slumpMin) : null,
        slumpMax: details.slumpMax ? Number(details.slumpMax) : null,
        pumpable: details.pumpable,
        notes: details.notes || null,
      }));
    }, 'Details saved.');
  }

  async function addMaterial(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    const m = materials.find((x) => String(x.id) === mat.materialId);
    if (!m) { setError('Pick a material first.'); return; }
    if (!(num(mat.targetQuantity) > 0)) { setError('Enter the quantity per cubic metre.'); return; }
    await run(async () => {
      const mats = (sel.materials as Row[]) ?? [];
      show(await mixDesignsApi.addMaterial(String(sel.id), {
        materialId: String(m.id),
        materialLabel: String(m.materialName),
        targetQuantity: num(mat.targetQuantity),
        uom: String(m.uom ?? 'kg'),
        tolerancePercentage: num(mat.tolerancePercentage) || 2,
        sequenceNo: mats.length + 1,
      }));
      setMat({ materialId: '', targetQuantity: '', tolerancePercentage: '2' });
    }, 'Material added.');
  }

  async function removeMaterial(mm: Row) {
    if (!sel) return;
    if (!(await confirm({ title: 'Remove material', message: `Remove ${String(mm.materialLabel ?? 'this material')} from the recipe?`, confirmLabel: 'Remove', danger: true }))) return;
    await run(async () => show(await mixDesignsApi.deleteMaterial(String(sel.id), String(mm.id))), 'Material removed.');
  }

  async function approve() {
    if (!sel) return;
    const retiring = rows.find((r) => r.gradeId && r.gradeId === sel.gradeId && String(r.approvalStatus) === 'approved' && r.isActiveVersion !== false && String(r.id) !== String(sel.id));
    const ok = await confirm({
      title: 'Approve mix design',
      message: `${String(sel.mixCode)} v${String(sel.versionNo)} becomes the recipe the plant batches for ${String(sel.gradeCode ?? 'its grade')}${retiring ? `, and ${String(retiring.mixCode)} v${String(retiring.versionNo)} is retired` : ''}. An approved design is locked; changes need a new version. Continue?`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    await run(async () => show(await mixDesignsApi.approve(String(sel.id))), `${String(sel.mixCode)} v${String(sel.versionNo)} approved${retiring ? `; ${String(retiring.mixCode)} v${String(retiring.versionNo)} retired` : ''}.`);
  }

  async function reject() {
    if (!sel) return;
    if (!(await confirm({ title: 'Reject mix design', message: `Reject ${String(sel.mixCode)} v${String(sel.versionNo)}? It stays on record but can never be batched.`, confirmLabel: 'Reject', danger: true }))) return;
    await run(async () => show(await mixDesignsApi.reject(String(sel.id))), 'Mix design rejected.');
  }

  const shown = filter ? rows.filter((r) => stageOf(r) === filter) : rows;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const coveredGrades = useMemo(() => new Set(rows.filter((r) => stageOf(r) === 'approved' && r.gradeId).map((r) => String(r.gradeId))), [rows]);
  const uncovered = useMemo(
    () => grades.filter((g) => String(g.status ?? 'active') === 'active' && !coveredGrades.has(String(g.id))).map((g) => String(g.gradeCode)),
    [grades, coveredGrades],
  );
  const drafts = counts.get('draft') ?? 0;

  const mats = (sel?.materials as Row[]) ?? [];
  const selStage = sel ? stageOf(sel) : '';
  const editable = selStage === 'draft';
  const matById = useMemo(() => new Map(materials.map((m) => [String(m.id), m])), [materials]);
  const chosenMat = matById.get(mat.materialId);

  return (
    <div className="mn-ord mn-md">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Mix designs</h1>
          <p>The plant&apos;s recipes: what one cubic metre of each grade is made of, and which version is approved. Only an approved design can be batched; approving a new version retires the old one for that grade.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <FlaskConical size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'design' : 'designs'}
            {' · '}
            {coveredGrades.size} of {grades.length} grades covered
          </span>
          <Link href="/app/entity/concrete-grades" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<Layers size={14} />}>Concrete grades</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Stage strip — counts per stage; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by stage">
        {STAGES.map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`}
              data-tone={s.tone}
              aria-pressed={on}
              title={s.hint}
              onClick={() => setFilter(on ? '' : s.key)}
            >
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && (
          <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>
            Show all
          </button>
        )}
      </div>

      {(uncovered.length > 0 || drafts > 0) && !filter && loaded && (
        <div className="mn-ord-notes">
          {uncovered.length > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <AlertTriangle size={16} aria-hidden />
              <span>
                <strong>{uncovered.length} {uncovered.length === 1 ? 'grade has' : 'grades have'} no approved recipe: {uncovered.join(', ')}.</strong>{' '}
                An order for one of them cannot be batched until a design for it is approved. Grades you never sell can be made inactive under Concrete grades.
              </span>
            </div>
          )}
          {drafts > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--btn" onClick={() => setFilter('draft')}>
              <FlaskConical size={16} aria-hidden />
              <span><strong>{drafts} draft {drafts === 1 ? 'design is' : 'designs are'} waiting for approval.</strong> Open one, check its materials, then Approve.</span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New mix design</span>}>
        <Form onSubmit={create} className="mn-md-form">
          <Field label="Mix code" required>
            <Input value={form.mixCode} onChange={(e) => setForm({ ...form, mixCode: e.target.value })} placeholder="M25-STD" required />
          </Field>
          <Field label="Grade" required>
            <Select value={form.gradeId} onChange={(e) => setForm({ ...form, gradeId: e.target.value })} required>
              <option value="">Pick the grade</option>
              {grades.map((g) => (
                <option key={String(g.id)} value={String(g.id)}>{String(g.gradeCode)}{g.gradeName && g.gradeName !== g.gradeCode ? ` · ${String(g.gradeName)}` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Cement">
            <Input value={form.cementType} onChange={(e) => setForm({ ...form, cementType: e.target.value })} placeholder="OPC 53" />
          </Field>
          <Field label="Water / cement">
            <Input type="number" step="0.01" inputMode="decimal" min={0} max={1} value={form.waterCementRatio} onChange={(e) => setForm({ ...form, waterCementRatio: e.target.value })} placeholder="0.45" />
          </Field>
          <Field label="Slump (mm)">
            <div className="mn-md-range">
              <Input type="number" inputMode="numeric" min={0} value={form.slumpMin} onChange={(e) => setForm({ ...form, slumpMin: e.target.value })} placeholder="min" aria-label="Slump minimum" />
              <span className="mn-ord-meta">to</span>
              <Input type="number" inputMode="numeric" min={0} value={form.slumpMax} onChange={(e) => setForm({ ...form, slumpMax: e.target.value })} placeholder="max" aria-label="Slump maximum" />
            </div>
          </Field>
          <label className="mn-md-check">
            <input type="checkbox" checked={form.pumpable} onChange={(e) => setForm({ ...form, pumpable: e.target.checked })} />
            <span>Pumpable</span>
          </label>
          <div className="mn-md-form-submit">
            <Button type="submit" icon={<Plus size={14} />} loading={busy}>Create draft</Button>
          </div>
        </Form>
        <p className="mn-board-form-hint">A design starts as a draft with no materials. Add each material&apos;s quantity per cubic metre below, then approve it; approving locks the recipe and retires the grade&apos;s previous version.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><FlaskConical size={16} aria-hidden /> Designs <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Press a design to open its recipe below.</span>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : shown.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Design</span>
              <span>Grade</span>
              <span>Recipe</span>
              <span>Batched</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const on = sel && String(sel.id) === String(r.id);
              const n = num(r.materialCount);
              const batches = num(r.batchCount);
              return (
                <div
                  key={String(r.id)}
                  className={`mn-ord-row mn-ord-row--acts mn-md-row${on ? ' is-on' : ''}`}
                  data-tone={toneOf(stage)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={!!on}
                  onClick={() => open(String(r.id))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(String(r.id)); } }}
                >
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.mixCode ?? '')} <span className="mn-md-ver">v{String(r.versionNo ?? 1)}</span></span>
                    <span className="mn-ord-meta">{r.cementType ? String(r.cementType) : 'Cement not set'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-od-grade">{String(r.gradeCode ?? 'No grade')}</span>
                    <span className="mn-ord-meta">{slumpOf(r)}</span>
                  </div>
                  <div className="mn-ord-val mn-md-recipe">
                    <span className="mn-ord-amt">{n ? `${n} ${n === 1 ? 'material' : 'materials'}` : 'No materials'}</span>
                    <span className="mn-ord-meta">{r.waterCementRatio != null ? `w/c ${qty(r.waterCementRatio)}` : 'w/c not set'}{r.pumpable ? ' · pumpable' : ''}</span>
                  </div>
                  <div className="mn-ord-when mn-md-used">
                    <span className="mn-ord-amt">{batches ? `${batches} ${batches === 1 ? 'batch' : 'batches'}` : 'Never'}</span>
                    <span className="mn-ord-meta">{r.lastBatchedAt ? `last ${formatDateTime(r.lastBatchedAt)}` : stage === 'approved' ? 'ready to batch' : ''}</span>
                  </div>
                  <div className="mn-ord-status"><Badge tone={toneOf(stage)}>{STAGES.find((s) => s.key === stage)?.label ?? stage}</Badge></div>
                  <div className="mn-ord-act mn-md-acts">
                    <Button variant={on ? 'ghost' : 'secondary'} size="sm" onClick={(e) => { e.stopPropagation(); open(String(r.id)); }}>{on ? 'Open below' : 'Open'}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : filter ? (
          <EmptyState title={`No ${labelOf(filter)} designs`} description="Press the chip again to show every design." />
        ) : (
          <EmptyState title="No mix designs yet" description="Create the first design above, add its materials per cubic metre, and approve it so the plant can batch that grade." />
        )}
      </Card>

      {sel && (
        <div className="mn-md-ws">
          <Card
            title={
              <span className="mn-board-card-title">
                <FlaskConical size={16} aria-hidden /> {String(sel.mixCode)} v{String(sel.versionNo ?? 1)}
                <span className="mn-md-sub">{String(sel.gradeCode ?? 'No grade')} · {sel.cementType ? String(sel.cementType) : 'cement not set'} · {sel.waterCementRatio != null ? `w/c ${qty(sel.waterCementRatio)}` : 'w/c not set'} · {slumpOf(sel)} · {sel.pumpable ? 'pumpable' : 'not pumpable'}</span>
                <Badge tone={toneOf(selStage)}>{STAGES.find((s) => s.key === selStage)?.label ?? selStage}</Badge>
              </span>
            }
            actions={
              <div className="mn-md-tools">
                {editable && <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={approve} disabled={busy || !mats.length}>Approve</Button>}
                {editable && <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={reject} disabled={busy}>Reject</Button>}
                {!editable && <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={newVersion} disabled={busy}>New version</Button>}
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setSel(null)} aria-label="Close recipe">Close</Button>
              </div>
            }
            padded={false}
          >
            <p className="mn-md-hint">
              {selStage === 'draft'
                ? (mats.length ? 'Check each quantity per cubic metre and the tolerance the batcher must hold, then Approve. Approving locks the recipe.' : 'Add the materials for one cubic metre below. Approve needs at least one material with a quantity.')
                : selStage === 'approved'
                  ? `This is what the plant batches for ${String(sel.gradeCode ?? 'this grade')}${num(sel.batchCount) ? `: ${qty(sel.batchCount)} ${num(sel.batchCount) === 1 ? 'batch' : 'batches'} so far${sel.lastBatchedAt ? `, last ${formatDateTime(sel.lastBatchedAt)}` : ''}` : ''}. It is locked${sel.approvedAt ? ` since ${formatDateTime(sel.approvedAt)}` : ''}; to change it, press New version, edit the copy and approve that.`
                  : selStage === 'retired'
                    ? 'An earlier version, replaced by a newer approved one. Kept for the batches that used it; press New version to start again from it.'
                    : 'Rejected at approval. Nothing is batched from it; press New version to start a corrected draft from it.'}
            </p>
            <div className="mn-id-scroll">
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Material</Th>
                    <Th numeric>Per m³</Th>
                    <Th numeric>Tolerance</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {mats.map((mm, i) => {
                    const master = mm.materialId ? matById.get(String(mm.materialId)) : undefined;
                    return (
                      <tr key={String(mm.id)}>
                        <Td><span className="mn-ord-meta">{i + 1}</span></Td>
                        <Td>
                          <span className="mn-od-num">{String(mm.materialLabel ?? master?.materialName ?? '—')}</span>
                          <span className="mn-od-rate-meta">{master ? `${String(master.materialCode ?? '')}${master.materialType ? ` · ${String(master.materialType).replace(/_/g, ' ')}` : ''}` : mm.materialId ? '' : 'Not linked to a stock material'}</span>
                        </Td>
                        <Td numeric><span className="mn-od-num">{qty(mm.targetQuantity)}</span> <span className="mn-ord-meta">{String(mm.uom ?? '')}</span></Td>
                        <Td numeric>±{qty(mm.tolerancePercentage)}%</Td>
                        <Td>
                          {editable && (
                            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => removeMaterial(mm)} disabled={busy} aria-label={`Remove ${String(mm.materialLabel ?? 'material')}`}>Remove</Button>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                  {!mats.length && (
                    <tr><Td colSpan={5}><span className="mn-ord-meta">No materials yet: add the first one below.</span></Td></tr>
                  )}
                </tbody>
                {mats.length > 0 && (
                  <tfoot>
                    <tr className="mn-md-total">
                      <Td colSpan={5}>{mats.length} {mats.length === 1 ? 'material' : 'materials'} per cubic metre · a batch scales every quantity by the load size, then corrects the aggregates for moisture · the tolerance is how far a weighed quantity may stray before the batch is flagged</Td>
                    </tr>
                  </tfoot>
                )}
              </Table>
            </div>

            {editable && (
              <Form onSubmit={addMaterial} className="mn-md-line">
                <Field label="Material" required>
                  <Select value={mat.materialId} onChange={(e) => setMat({ ...mat, materialId: e.target.value })} required>
                    <option value="">Pick a material</option>
                    {materials.map((m) => (
                      <option key={String(m.id)} value={String(m.id)}>{String(m.materialName)}{m.uom ? ` (${String(m.uom)})` : ''}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={chosenMat ? `Per m³ (${String(chosenMat.uom ?? 'kg')})` : 'Per m³'} required>
                  <Input type="number" step="any" inputMode="decimal" min={0} value={mat.targetQuantity} onChange={(e) => setMat({ ...mat, targetQuantity: e.target.value })} required />
                </Field>
                <Field label="Tolerance ±%">
                  <Input type="number" step="any" inputMode="decimal" min={0} value={mat.tolerancePercentage} onChange={(e) => setMat({ ...mat, tolerancePercentage: e.target.value })} />
                </Field>
                <div className="mn-md-line-submit">
                  <Button type="submit" variant="secondary" icon={<Plus size={14} />} disabled={busy || !mat.materialId}>Add material</Button>
                </div>
              </Form>
            )}

            {editable && (
              <Form onSubmit={saveDetails} className="mn-md-details">
                <span className="mn-md-details-title">Details</span>
                <Field label="Cement">
                  <Input value={details.cementType} onChange={(e) => setDetails({ ...details, cementType: e.target.value })} placeholder="OPC 53" />
                </Field>
                <Field label="Water / cement">
                  <Input type="number" step="0.01" inputMode="decimal" min={0} max={1} value={details.waterCementRatio} onChange={(e) => setDetails({ ...details, waterCementRatio: e.target.value })} placeholder="0.45" />
                </Field>
                <Field label="Slump (mm)">
                  <div className="mn-md-range">
                    <Input type="number" inputMode="numeric" min={0} value={details.slumpMin} onChange={(e) => setDetails({ ...details, slumpMin: e.target.value })} placeholder="min" aria-label="Slump minimum" />
                    <span className="mn-ord-meta">to</span>
                    <Input type="number" inputMode="numeric" min={0} value={details.slumpMax} onChange={(e) => setDetails({ ...details, slumpMax: e.target.value })} placeholder="max" aria-label="Slump maximum" />
                  </div>
                </Field>
                <label className="mn-md-check">
                  <input type="checkbox" checked={details.pumpable} onChange={(e) => setDetails({ ...details, pumpable: e.target.checked })} />
                  <span>Pumpable</span>
                </label>
                <Field label="Notes">
                  <Input value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} placeholder="Where the design came from, trial mix reference…" />
                </Field>
                <div className="mn-md-details-submit">
                  <Button type="submit" variant="secondary" size="sm" icon={<Save size={14} />} disabled={busy}>Save details</Button>
                </div>
              </Form>
            )}
            {!editable && sel.notes ? <p className="mn-md-notes"><strong>Notes.</strong> {String(sel.notes)}</p> : null}
          </Card>
        </div>
      )}
    </div>
  );
}
