'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ClipboardCheck, Cpu, Landmark, Pause, Play, RefreshCw, Save, ScrollText, XCircle } from 'lucide-react';
import { formatDateTime } from '../../../lib/format-date';
import { agentsApi, type AgentControls, type Row } from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

type Llm = { configured: boolean; provider: string; model: string; askEnabledAgents: string[] };
type Catalog = Array<{ name: string; description: string; tools: string[] }>;
type GstStatus = { configured: boolean; provider: string };

/**
 * Agent governor — the switches and the record for the automation agents.
 *
 * A pill says whether automation is running, notes flag a pause, the
 * actions waiting for a decision and a missing model, and the cards
 * follow: the switch and the per-run budgets; one row per agent (what it
 * does in plain words, the tools it may use, its state, Pause / Resume);
 * the actions waiting for approval with Approve / Reject; the run history
 * with a status strip as the filter; and the GST queue. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const AGENTS: Record<string, { label: string; blurb: string }> = {
  diagnostics: { label: 'Diagnostics', blurb: 'Checks that the agent machinery itself is healthy. Internal.' },
  'data-analysis': { label: 'Data analysis', blurb: 'Reads the figures and answers questions about sales, customers and stock. Changes nothing.' },
  monitor: { label: 'Monitor', blurb: 'Watches stock, credit and overdue invoices and raises alerts. Changes nothing.' },
  specialist: { label: 'Specialist', blurb: 'Gives cited advice on GST compliance and credit risk. Changes nothing.' },
  'customer-service': { label: 'Customer service', blurb: 'Answers a customer about their own orders and account. Read-only, one customer at a time.' },
  automation: { label: 'Automation', blurb: 'Prepares actions such as e-invoices and reminders; anything that changes data waits for a person to approve it.' },
};
const agentLabel = (n: unknown) => AGENTS[String(n ?? '')]?.label ?? String(n ?? '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const ACTIONS: Record<string, string> = { einvoice: 'File an e-invoice', eway: 'Make an e-way bill', einvoice_cancel: 'Cancel an e-invoice', eway_cancel: 'Cancel an e-way bill', reminder: 'Send a payment reminder' };
const actionLabel = (k: unknown) => ACTIONS[String(k ?? '')] ?? String(k ?? '').replace(/_/g, ' ');
const outcomeText = (o: unknown): string => {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  const r = o as Record<string, unknown>;
  return String(r.reason ?? r.message ?? r.summary ?? '');
};
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const RUN_STATES: Array<{ key: string; label: string; tone: Tone }> = [
  { key: 'completed', label: 'Completed', tone: 'success' },
  { key: 'running', label: 'Running', tone: 'info' },
  { key: 'failed', label: 'Failed', tone: 'danger' },
  { key: 'escalated', label: 'Escalated', tone: 'warning' },
];
const runTone = (s: string): Tone => RUN_STATES.find((x) => x.key === s)?.tone ?? 'neutral';

export default function AgentGovernorPage() {
  const { confirm, prompt } = useConfirm();
  const [controls, setControls] = useState<AgentControls | null>(null);
  const [steps, setSteps] = useState('');
  const [actions, setActions] = useState('');
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [pauses, setPauses] = useState<Record<string, boolean>>({});
  const [llm, setLlm] = useState<Llm | null>(null);
  const [runs, setRuns] = useState<Row[]>([]);
  const [approvals, setApprovals] = useState<Row[]>([]);
  const [gstJobs, setGstJobs] = useState<Row[]>([]);
  const [gstStatus, setGstStatus] = useState<GstStatus | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [runFilter, setRunFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const canApp = getAccess().has('agents.approve');
    setCanApprove(canApp);
    const [c, cat, p, l, r] = await Promise.all([
      agentsApi.controls(),
      agentsApi.catalog(),
      agentsApi.pauses(),
      agentsApi.llm(),
      agentsApi.runs(50),
    ]);
    setControls(c);
    setSteps(String(c.maxStepsPerRun));
    setActions(String(c.maxActionsPerRun));
    setCatalog(cat as Catalog);
    setPauses(p);
    setLlm(l);
    setRuns(r);
    if (canApp) {
      const [ap, gj, gs] = await Promise.all([agentsApi.approvals('pending'), agentsApi.gstJobs(), agentsApi.gstStatus()]);
      setApprovals(ap);
      setGstJobs(gj);
      setGstStatus(gs);
    }
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleKill() {
    if (!controls) return;
    const pausing = !controls.automationPaused;
    if (pausing && !(await confirm({
      title: 'Pause all automation',
      message: 'Every agent stops for this company, including the scheduled monitors and any escalations, until you resume. A run already in progress finishes; no new one starts.',
      confirmLabel: 'Pause automation',
      danger: true,
    }))) return;
    await act(() => agentsApi.setControls({ automationPaused: pausing }), pausing ? 'Automation paused. Nothing runs until you resume it.' : 'Automation resumed.');
  }

  async function saveBudgets() {
    const s = Number(steps);
    const a = Number(actions);
    if (!Number.isInteger(s) || s < 0 || s > 10000) { setError('Steps per run must be a whole number from 0 to 10,000.'); return; }
    if (!Number.isInteger(a) || a < 0 || a > 1000) { setError('Actions per run must be a whole number from 0 to 1,000.'); return; }
    await act(() => agentsApi.setControls({ maxStepsPerRun: s, maxActionsPerRun: a }), `Budgets saved: ${s} steps and ${a} actions per run.`);
  }

  async function togglePause(name: string, currentlyPaused: boolean) {
    const pausing = !currentlyPaused;
    if (pausing && !(await confirm({
      title: `Pause ${agentLabel(name)}`,
      message: `${agentLabel(name)} stops running; the other agents and the scheduled work carry on. Resume it here at any time.`,
      confirmLabel: 'Pause agent',
      danger: true,
    }))) return;
    await act(() => agentsApi.setPause(name, pausing), pausing ? `${agentLabel(name)} paused.` : `${agentLabel(name)} resumed.`);
  }

  async function approve(a: Row) {
    if (!(await confirm({ title: `Approve: ${String(a.title)}`, message: String(a.reversibility) === 'irreversible' ? 'This cannot be undone once it is sent. A GST action is queued for the portal.' : 'The action goes ahead. A GST action is queued for the portal.', confirmLabel: 'Approve' }))) return;
    await act(() => agentsApi.decide(String(a.id), 'approved'), `Approved: ${String(a.title)}.`);
  }
  async function reject(a: Row) {
    const reason = await prompt({ title: `Reject: ${String(a.title)}`, message: 'The agent is told why, so it does not ask the same thing again.', label: 'Why (optional)', placeholder: 'e.g. The invoice is being revised', confirmLabel: 'Reject' });
    if (reason === null) return; // cancelled
    await act(() => agentsApi.decide(String(a.id), 'rejected', reason || undefined), `Rejected: ${String(a.title)}.`);
  }
  async function drain() {
    await act(async () => {
      const res = await agentsApi.drainGstJobs();
      setMsg(`${String((res as Row).processed ?? 0)} ${num((res as Row).processed) === 1 ? 'job' : 'jobs'} processed.`);
    }, 'Queue processed.');
  }

  const paused = controls?.automationPaused ?? false;
  const runCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of runs) c.set(String(r.status ?? ''), (c.get(String(r.status ?? '')) ?? 0) + 1);
    return c;
  }, [runs]);
  const shownRuns = runFilter ? runs.filter((r) => String(r.status) === runFilter) : runs;
  const failedRuns = runCounts.get('failed') ?? 0;
  const budgetsDirty = controls ? steps !== String(controls.maxStepsPerRun) || actions !== String(controls.maxActionsPerRun) : false;
  const pausedAgents = catalog.filter((a) => pauses[a.name] === true).length;

  return (
    <div className="mn-ord mn-ag">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Agent governor</h1>
          <p>The automation agents read the plant's data, watch for trouble and prepare actions such as e-invoices and reminders. Nothing that changes data goes out without a person approving it here. This screen is the switch, the budgets, the approvals and the record of every run.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Bot size={14} aria-hidden />
            {loaded ? (paused ? 'Automation paused' : `Running · ${catalog.length - pausedAgents} of ${catalog.length} agents on`) : 'Loading…'}
          </span>
          <Button variant={paused ? undefined : 'secondary'} icon={paused ? <Play size={14} /> : <Pause size={14} />} onClick={toggleKill} loading={busy} disabled={!controls}>
            {paused ? 'Resume automation' : 'Pause all automation'}
          </Button>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {loaded && (paused || approvals.length > 0 || (llm && !llm.configured) || failedRuns > 0) && (
        <div className="mn-ord-notes">
          {paused && (
            <div className="mn-ord-note mn-ord-note--bad" role="status">
              <Pause size={16} aria-hidden />
              <span><strong>All automation is paused.</strong> No agent runs, no monitor watches, no reminder goes out until you press Resume automation.</span>
            </div>
          )}
          {approvals.length > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <ClipboardCheck size={16} aria-hidden />
              <span><strong>{approvals.length} {approvals.length === 1 ? 'action is' : 'actions are'} waiting for a decision.</strong> An agent prepared {approvals.length === 1 ? 'it' : 'them'}; nothing is sent until you approve.</span>
            </div>
          )}
          {failedRuns > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setRunFilter('failed')}>
              <AlertTriangle size={16} aria-hidden />
              <span><strong>{failedRuns} {failedRuns === 1 ? 'run' : 'runs'} failed</strong> in the last {runs.length}. Open the run history for the reason; a run that hits its budget is the usual cause.</span>
            </button>
          )}
          {llm && !llm.configured && (
            <div className="mn-ord-note" role="status">
              <Cpu size={16} aria-hidden />
              <span><strong>No language model is set up,</strong> so the agents run on fixed rules only and cannot be asked free questions. An administrator sets an API key on the server to switch that on.</span>
            </div>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <Card title={<span className="mn-board-card-title"><Cpu size={16} aria-hidden /> Budgets per run</span>} actions={<span className="mn-ord-how">A run that reaches a budget stops and is marked failed; nothing half-done goes out.</span>}>
        <div className="mn-ag-budgets">
          <Field label="Steps per run" help="Tool calls and lookups one run may make.">
            <Input type="number" inputMode="numeric" min={0} max={10000} value={steps} onChange={(e) => setSteps(e.target.value)} />
          </Field>
          <Field label="Actions per run" help="Writes one run may prepare for approval.">
            <Input type="number" inputMode="numeric" min={0} max={1000} value={actions} onChange={(e) => setActions(e.target.value)} />
          </Field>
          <div className="mn-ag-budgets-save">
            <Button variant={budgetsDirty ? undefined : 'ghost'} size="sm" icon={<Save size={14} />} onClick={saveBudgets} loading={busy} disabled={!controls || !budgetsDirty}>Save budgets</Button>
            <span className="mn-ord-meta">{llm ? (llm.configured ? `Model: ${llm.provider} · ${llm.model}` : 'Rules only; no model') : ''}</span>
          </div>
        </div>
      </Card>

      <Card title={<span className="mn-board-card-title"><Bot size={16} aria-hidden /> Agents <span className="mn-board-card-count">{catalog.length}</span></span>} actions={<span className="mn-ord-how">Each agent may use only the tools listed; nothing else.</span>} padded={false}>
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={4} /></div>
        ) : catalog.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts mn-ag-cols" aria-hidden>
              <span>Agent</span>
              <span>Tools it may use</span>
              <span>State</span>
              <span />
            </div>
            {catalog.map((a) => {
              const agentPaused = pauses[a.name] === true;
              const off = paused || agentPaused;
              return (
                <div key={a.name} className={`mn-ord-row mn-ord-row--acts mn-ag-row${off ? ' is-void' : ''}`} data-tone={off ? 'neutral' : 'success'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{agentLabel(a.name)}{llm?.askEnabledAgents.includes(a.name) ? <span className="mn-ord-meta"> · can be asked</span> : null}</span>
                    <span className="mn-ord-meta">{AGENTS[a.name]?.blurb ?? a.description}</span>
                  </div>
                  <div className="mn-ag-tools">
                    {a.tools.length ? a.tools.map((t) => <Badge key={t} tone="neutral">{t}</Badge>) : <span className="mn-ord-meta">none</span>}
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={paused ? 'paused' : agentPaused ? 'paused' : 'active'} /></div>
                  <div className="mn-ord-act mn-ag-acts">
                    {paused ? (
                      <span className="mn-ord-meta">all paused</span>
                    ) : (
                      <Button variant={agentPaused ? 'secondary' : 'ghost'} size="sm" icon={agentPaused ? <Play size={14} /> : <Pause size={14} />} onClick={() => togglePause(a.name, agentPaused)} disabled={busy}>
                        {agentPaused ? 'Resume' : 'Pause'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No agents registered" description="The agents are part of the server build; none is registered on this one." />
        )}
      </Card>

      {canApprove && (
        <Card title={<span className="mn-board-card-title"><ClipboardCheck size={16} aria-hidden /> Waiting for approval <span className="mn-board-card-count">{approvals.length}</span></span>} actions={<span className="mn-ord-how">An agent prepared each one; you decide. Irreversible ones cannot be undone once sent.</span>} padded={false}>
          {!loaded ? (
            <div className="mn-ord-skel"><TableSkeleton cols={4} /></div>
          ) : approvals.length ? (
            <div className="mn-ord-list" role="list">
              <div className="mn-ord-cols mn-ord-cols--acts mn-ag-acols" aria-hidden>
                <span>Action</span>
                <span>Asked by</span>
                <span>Undo</span>
                <span />
              </div>
              {approvals.map((a) => (
                <div key={String(a.id)} className="mn-ord-row mn-ord-row--acts mn-ag-arow" data-tone={String(a.reversibility) === 'irreversible' ? 'danger' : 'warning'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(a.title)}</span>
                    <span className="mn-ord-meta">{actionLabel(a.actionKind)}{a.entityType ? ` · ${String(a.entityType).replace(/_/g, ' ')}` : ''}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{agentLabel(a.agentName)}</span>
                    <span className="mn-ord-meta">{formatDateTime(a.createdAt)}</span>
                  </div>
                  <div className="mn-ord-status">{String(a.reversibility) === 'irreversible' ? <Badge tone="danger">cannot be undone</Badge> : <Badge tone="success">can be undone</Badge>}</div>
                  <div className="mn-ord-act mn-ag-acts">
                    <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => approve(a)} disabled={busy}>Approve</Button>
                    <Button variant="ghost" size="sm" icon={<XCircle size={14} />} onClick={() => reject(a)} disabled={busy}>Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing waiting" description="Actions an agent prepares (an e-invoice, an e-way bill, a reminder) appear here for a decision." />
          )}
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><ScrollText size={16} aria-hidden /> Run history <span className="mn-board-card-count">{shownRuns.length}</span></span>}
        actions={
          <div className="mn-board-strip mn-ag-strip" role="group" aria-label="Filter runs by status">
            {RUN_STATES.filter((s) => runCounts.has(s.key)).map((s) => {
              const on = runFilter === s.key;
              return (
                <button key={s.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}`} data-tone={s.tone} aria-pressed={on} onClick={() => setRunFilter(on ? '' : s.key)}>
                  <span className="mn-board-chip-n">{runCounts.get(s.key)}</span>
                  <span className="mn-board-chip-l">{s.label}</span>
                </button>
              );
            })}
            {runFilter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setRunFilter('')}>All</button>}
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shownRuns.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ag-rcols" aria-hidden>
              <span>Run</span>
              <span>Used</span>
              <span>What came of it</span>
              <span>Status</span>
            </div>
            {shownRuns.map((r) => (
              <div key={String(r.id)} className={`mn-ord-row mn-ag-rrow${String(r.status) === 'failed' ? '' : ''}`} data-tone={runTone(String(r.status ?? ''))} role="listitem">
                <div className="mn-ord-id">
                  <span className="mn-ord-no">{agentLabel(r.agentName)}</span>
                  <span className="mn-ord-meta">{formatDateTime(r.createdAt)}{r.taskKind && r.taskKind !== r.agentName ? ` · ${String(r.taskKind).replace(/_/g, ' ')}` : ''}</span>
                </div>
                <div className="mn-ag-used">
                  <span>{num(r.stepsUsed)} {num(r.stepsUsed) === 1 ? 'step' : 'steps'}</span>
                  <span className="mn-ord-meta">{num(r.actionsUsed)} {num(r.actionsUsed) === 1 ? 'action' : 'actions'}</span>
                </div>
                <div className="mn-ag-outcome">
                  <span>{r.summary ? String(r.summary) : outcomeText(r.outcome) || <span className="mn-ord-meta">No summary</span>}</span>
                  {r.summary && outcomeText(r.outcome) ? <span className="mn-ord-meta">{outcomeText(r.outcome)}</span> : null}
                </div>
                <div className="mn-ord-status"><StatusBadge status={String(r.status ?? '')} /></div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={runFilter ? `No ${runFilter} runs` : 'No runs yet'} description={runFilter ? 'Press the chip again to see every run.' : 'Every agent run and what came of it appears here, newest first.'} action={runFilter ? <Button variant="secondary" size="sm" onClick={() => setRunFilter('')}>Show all</Button> : undefined} />
        )}
      </Card>

      {canApprove && (
        <Card
          title={<span className="mn-board-card-title"><Landmark size={16} aria-hidden /> GST queue <span className="mn-board-card-count">{gstJobs.length}</span></span>}
          actions={<div className="mn-ro-ws-actions">{gstStatus ? (gstStatus.configured ? <Badge tone="success">portal on</Badge> : <Badge tone="neutral">portal off</Badge>) : null}<Button variant="secondary" size="sm" onClick={drain} loading={busy}>Send now</Button></div>}
          padded={false}
        >
          {!loaded ? (
            <div className="mn-ord-skel"><TableSkeleton cols={4} /></div>
          ) : gstJobs.length ? (
            <div className="mn-ord-list" role="list">
              <div className="mn-ord-cols mn-ag-gcols" aria-hidden>
                <span>Action</span>
                <span>Tries</span>
                <span>Last result</span>
                <span>Status</span>
              </div>
              {gstJobs.map((j) => (
                <div key={String(j.id)} className="mn-ord-row mn-ag-grow" data-tone={String(j.status) === 'failed' ? 'danger' : String(j.status) === 'done' || String(j.status) === 'completed' ? 'success' : 'info'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{actionLabel(j.actionKind)}</span>
                    <span className="mn-ord-meta">{j.nextRunAt ? `next try ${formatDateTime(j.nextRunAt)}` : 'no retry planned'}</span>
                  </div>
                  <div className="mn-ag-used">
                    <span>{num(j.attempts)} of {num(j.maxAttempts)}</span>
                  </div>
                  <div className="mn-ag-outcome">
                    <span className={j.lastError ? 'mn-id-bad' : ''}>{j.lastError ? String(j.lastError) : j.lastOutcome ? outcomeText(j.lastOutcome) : <span className="mn-ord-meta">Not sent yet</span>}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={String(j.status ?? '')} /></div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Queue empty" description={gstStatus && !gstStatus.configured ? 'No GST provider is set up on this server: approved actions are prepared but not sent to the portal.' : 'Approved GST actions wait here until they are sent to the portal.'} />
          )}
        </Card>
      )}
    </div>
  );
}
