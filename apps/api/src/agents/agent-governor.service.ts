import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AgentControl } from '../core/database/entities';

/** The effective controls for a tenant (a row, or the built-in defaults). */
export interface AgentControls {
  automationPaused: boolean;
  maxStepsPerRun: number;
  maxActionsPerRun: number;
}

/** Built-in defaults when a tenant has no `agent_controls` row yet. */
export const DEFAULT_CONTROLS: AgentControls = {
  automationPaused: false,
  maxStepsPerRun: 50,
  maxActionsPerRun: 10,
};

/** Pure: is one more tool call allowed within the step cap? */
export function stepAllowed(stepsUsed: number, maxSteps: number): boolean {
  return stepsUsed < maxSteps;
}

/** Pure: is one more WRITE action allowed within the action cap? */
export function actionAllowed(actionsUsed: number, maxActions: number): boolean {
  return actionsUsed < maxActions;
}

/**
 * Owns the kill switch and the per-run budgets — the runaway-loop backstop and
 * the per-tenant "stop all automation" control (WR-AGT-6). DB-backed so the
 * switch survives a restart and is per-tenant; reads/writes go through
 * `runInTenant`, so RLS keeps one tenant's controls invisible to another.
 */
@Injectable()
export class AgentGovernorService {
  constructor(private readonly db: TenantDbService) {}

  /** The effective controls for a tenant. Absent row → safe defaults (not paused). */
  async getControls(tenantId: string): Promise<AgentControls> {
    const row = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(AgentControl).findOne({ where: { tenantId } }),
    );
    if (!row) return { ...DEFAULT_CONTROLS };
    return {
      automationPaused: row.automationPaused,
      maxStepsPerRun: row.maxStepsPerRun,
      maxActionsPerRun: row.maxActionsPerRun,
    };
  }

  /**
   * Upsert the tenant's controls (the kill switch and/or the budgets). Only the
   * provided fields change; the rest keep their current or default value.
   */
  async setControls(
    tenantId: string,
    patch: Partial<AgentControls>,
    actorUserId: string | null,
  ): Promise<AgentControls> {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(AgentControl);
      const existing = await repo.findOne({ where: { tenantId } });
      const merged: AgentControl = repo.create({
        tenantId,
        automationPaused: patch.automationPaused ?? existing?.automationPaused ?? DEFAULT_CONTROLS.automationPaused,
        maxStepsPerRun: patch.maxStepsPerRun ?? existing?.maxStepsPerRun ?? DEFAULT_CONTROLS.maxStepsPerRun,
        maxActionsPerRun:
          patch.maxActionsPerRun ?? existing?.maxActionsPerRun ?? DEFAULT_CONTROLS.maxActionsPerRun,
        lastDiagnosticAt: existing?.lastDiagnosticAt ?? null,
        updatedBy: actorUserId,
      });
      await repo.save(merged);
      return {
        automationPaused: merged.automationPaused,
        maxStepsPerRun: merged.maxStepsPerRun,
        maxActionsPerRun: merged.maxActionsPerRun,
      };
    });
  }
}
