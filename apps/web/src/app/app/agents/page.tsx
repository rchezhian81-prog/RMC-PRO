'use client';

import { useCallback, useEffect, useState } from 'react';
import { agentsApi, type AgentControls, type Row } from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { StatCard } from '../../../components/ui/StatCard';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { StatusBadge } from '../../../components/ui/Badge';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

type Llm = { configured: boolean; provider: string; model: string; askEnabledAgents: string[] };
type Catalog = Array<{ name: string; description: string; tools: string[] }>;
type GstStatus = { configured: boolean; provider: string };

const when = (v: unknown): string => {
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return v ? String(v) : '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const outcomeText = (o: unknown): string => {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  const r = o as Record<string, unknown>;
  return String(r.reason ?? r.message ?? r.summary ?? '');
};

export default function AgentGovernorPage() {
  const { confirm, prompt } = useConfirm();
  const [controls, setControls] = useState<AgentControls | null>(null);
  const [steps, setSteps] = useState('');
  const [actions, setActions] = useState('');
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [llm, setLlm] = useState<Llm | null>(null);
  const [runs, setRuns] = useState<Row[]>([]);
  const [approvals, setApprovals] = useState<Row[]>([]);
  const [gstJobs, setGstJobs] = useState<Row[]>([]);
  const [gstStatus, setGstStatus] = useState<GstStatus | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const canApp = getAccess().has('agents.approve');
    setCanApprove(canApp);
    const [c, cat, l, r] = await Promise.all([
      agentsApi.controls(),
      agentsApi.catalog(),
      agentsApi.llm(),
      agentsApi.runs(50),
    ]);
    setControls(c);
    setSteps(String(c.maxStepsPerRun));
    setActions(String(c.maxActionsPerRun));
    setCatalog(cat as Catalog);
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
      message: 'This stops every agent run for this company — including scheduled monitors and any escalations — until you resume. In-flight runs finish; no new run starts.',
      confirmLabel: 'Pause automation',
      danger: true,
    }))) return;
    await act(() => agentsApi.setControls({ automationPaused: pausing }), pausing ? 'Automation paused.' : 'Automation resumed.');
  }

  async function saveBudgets() {
    const s = Number(steps);
    const a = Number(actions);
    if (!Number.isInteger(s) || s < 0 || s > 10000) { setError('Steps per run must be a whole number from 0 to 10000.'); return; }
    if (!Number.isInteger(a) || a < 0 || a > 1000) { setError('Actions per run must be a whole number from 0 to 1000.'); return; }
    await act(() => agentsApi.setControls({ maxStepsPerRun: s, maxActionsPerRun: a }), 'Budgets saved.');
  }

  async function approve(a: Row) {
    if (!(await confirm({ title: 'Approve action', message: `Approve “${String(a.title)}”? A GST action will be queued for transmission to the portal.`, confirmLabel: 'Approve' }))) return;
    await act(() => agentsApi.decide(String(a.id), 'approved'), 'Action approved.');
  }
  async function reject(a: Row) {
    const reason = await prompt({ title: 'Reject action', message: `Reject “${String(a.title)}”?`, label: 'Reason (optional)', placeholder: 'Why is this being rejected?', confirmLabel: 'Reject' });
    if (reason === null) return; // cancelled
    await act(() => agentsApi.decide(String(a.id), 'rejected', reason || undefined), 'Action rejected.');
  }
  async function drain() {
    await act(async () => {
      const res = await agentsApi.drainGstJobs();
      setMsg(`Processed ${String((res as Row).processed ?? 0)} job(s).`);
    }, 'Queue drained.');
  }

  const paused = controls?.automationPaused ?? false;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Agent Governor</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          The control surface for the automation agents — the kill switch, per-run budgets, the approval queue, and the run trail.
        </p>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      {/* A · Controls */}
      <Card title="Controls">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard label="Automation" value={paused ? 'Paused' : 'Running'} tone={paused ? 'danger' : 'success'} />
          <StatCard label="Steps / run" value={controls ? String(controls.maxStepsPerRun) : '—'} />
          <StatCard label="Actions / run" value={controls ? String(controls.maxActionsPerRun) : '—'} />
          <StatCard label="LLM" value={llm ? (llm.configured ? llm.provider : 'Not configured') : '—'} tone="info" />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <Button variant={paused ? 'primary' : 'secondary'} onClick={toggleKill} loading={busy} disabled={!controls}>
            {paused ? 'Resume automation' : 'Pause automation'}
          </Button>
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--mn-border)' }} aria-hidden />
          <div style={{ maxWidth: 130 }}><Field label="Steps / run"><Input type="number" min={0} max={10000} value={steps} onChange={(e) => setSteps(e.target.value)} /></Field></div>
          <div style={{ maxWidth: 130 }}><Field label="Actions / run"><Input type="number" min={0} max={1000} value={actions} onChange={(e) => setActions(e.target.value)} /></Field></div>
          <Button variant="secondary" onClick={saveBudgets} loading={busy} disabled={!controls}>Save budgets</Button>
          <span style={{ color: 'var(--mn-muted)', fontSize: 12, maxWidth: 320 }}>
            The kill switch is company-wide and survives a restart. Budgets cap tool calls and writes within a single run.
          </span>
        </div>
      </Card>

      {/* B · Agent roster */}
      <Card title="Agent roster" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={3} />
        ) : catalog.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>What it does</Th>
                  <Th>Tools (allow-list)</Th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((a) => (
                  <tr key={a.name}>
                    <Td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{a.name}</Td>
                    <Td style={{ color: 'var(--mn-muted)' }}>{a.description}</Td>
                    <Td style={{ fontSize: 12.5 }}>{a.tools.length ? a.tools.join(', ') : <span style={{ color: 'var(--mn-muted)' }}>none</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No agents registered" />
        )}
        {llm && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--mn-border)', fontSize: 12.5, color: 'var(--mn-muted)' }}>
            LLM: {llm.configured ? `${llm.provider} · ${llm.model}` : 'not configured (agents run deterministically)'}
            {llm.askEnabledAgents.length ? ` · ask-enabled: ${llm.askEnabledAgents.join(', ')}` : ''}
          </div>
        )}
      </Card>

      {/* D · Approvals (agents.approve) */}
      {canApprove && (
        <Card title={`Pending approvals${approvals.length ? ` — ${approvals.length}` : ''}`} padded={false}>
          {!loaded ? (
            <TableSkeleton cols={4} />
          ) : approvals.length ? (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Action</Th>
                    <Th>Kind</Th>
                    <Th>Reversibility</Th>
                    <Th>Requested</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((a) => (
                    <tr key={a.id}>
                      <Td style={{ fontWeight: 600 }}>{String(a.title)}</Td>
                      <Td style={{ fontSize: 12.5 }}>{String(a.actionKind ?? '')}</Td>
                      <Td><StatusBadge status={String(a.reversibility ?? '')} /></Td>
                      <Td style={{ whiteSpace: 'nowrap', color: 'var(--mn-muted)' }}>{when(a.createdAt)}</Td>
                      <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button variant="secondary" size="sm" onClick={() => approve(a)} disabled={busy}>Approve</Button>{' '}
                        <Button variant="ghost" size="sm" onClick={() => reject(a)} disabled={busy}>Reject</Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="Nothing awaiting approval" description="Actions an agent prepares (e-invoice, e-way, reminders) appear here for a human decision." />
          )}
        </Card>
      )}

      {/* C · Run history */}
      <Card title="Run history" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : runs.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Status</Th>
                  <Th numeric>Steps</Th>
                  <Th numeric>Writes</Th>
                  <Th>Outcome</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{String(r.agentName)}</Td>
                    <Td><StatusBadge status={String(r.status ?? '')} /></Td>
                    <Td numeric>{String(r.stepsUsed ?? 0)}</Td>
                    <Td numeric>{String(r.actionsUsed ?? 0)}</Td>
                    <Td style={{ color: 'var(--mn-muted)', fontSize: 12.5, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={outcomeText(r.outcome)}>
                      {r.summary ? String(r.summary) : outcomeText(r.outcome)}
                    </Td>
                    <Td style={{ whiteSpace: 'nowrap', color: 'var(--mn-muted)' }}>{when(r.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No runs yet" description="Agent runs and their outcomes appear here, newest first." />
        )}
      </Card>

      {/* E · GST execution jobs (agents.approve) */}
      {canApprove && (
        <Card
          title="GST execution queue"
          padded={false}
          actions={<Button variant="secondary" size="sm" onClick={drain} loading={busy}>Drain now</Button>}
        >
          {!loaded ? (
            <TableSkeleton cols={5} />
          ) : gstJobs.length ? (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Action</Th>
                    <Th>Status</Th>
                    <Th numeric>Attempts</Th>
                    <Th>Last outcome</Th>
                    <Th>Next run</Th>
                  </tr>
                </thead>
                <tbody>
                  {gstJobs.map((j) => (
                    <tr key={j.id}>
                      <Td style={{ fontWeight: 600, fontSize: 12.5 }}>{String(j.actionKind ?? '')}</Td>
                      <Td><StatusBadge status={String(j.status ?? '')} /></Td>
                      <Td numeric>{String(j.attempts ?? 0)} / {String(j.maxAttempts ?? 0)}</Td>
                      <Td style={{ color: 'var(--mn-muted)', fontSize: 12.5 }}>{String(j.lastError ?? j.lastOutcome ?? '')}</Td>
                      <Td style={{ whiteSpace: 'nowrap', color: 'var(--mn-muted)' }}>{when(j.nextRunAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="Queue empty" description={gstStatus && !gstStatus.configured ? 'No GST provider is configured — approved actions are prepared but not transmitted.' : 'Approved GST actions queue here for transmission to the portal.'} />
          )}
        </Card>
      )}
    </div>
  );
}
