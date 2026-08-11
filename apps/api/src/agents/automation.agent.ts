import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ApprovalService } from './approval.service';
import {
  buildEinvoicePayload, buildEwayPayload, buildEinvoiceCancelPayload, buildEwayCancelPayload,
  buildEwayUpdateVehiclePayload, buildEwayExtendPayload,
} from './compliance.util';
import type { AgentToolDef, ToolContext } from './agent.types';

/** Columns the compliance-prepare tools read, projected to camelCase. */
const INVOICE_SELECT = `SELECT id, invoice_no AS "invoiceNo", invoice_date AS "invoiceDate",
  total_amount AS "totalAmount", taxable_amount AS "taxableAmount",
  cgst_amount AS "cgstAmount", sgst_amount AS "sgstAmount", igst_amount AS "igstAmount",
  cess_amount AS "cessAmount", place_of_supply AS "placeOfSupply", gstin,
  distance_km AS "distanceKm", transport_mode AS "transportMode", vehicle_no AS "vehicleNo",
  einvoice_status AS "einvoiceStatus", eway_status AS "ewayStatus", invoice_status AS "invoiceStatus"
  FROM invoices WHERE id = $1`;

async function loadInvoice(ctx: ToolContext): Promise<Record<string, unknown>> {
  const invoiceId = (ctx.args as { invoiceId?: unknown })?.invoiceId;
  if (!invoiceId || typeof invoiceId !== 'string') throw new Error('a compliance prepare requires an invoiceId');
  const [inv] = await ctx.manager.query(INVOICE_SELECT, [invoiceId]);
  if (!inv) throw new Error('invoice not found');
  return inv;
}

export const AGENT_AUTOMATION = 'automation';

/**
 * The Automation agent (M4) — the first agent with WRITE tools, added one at a
 * time behind the policy engine. It demonstrates both sides of the hard rule:
 *
 *   - `automation.open_approval` (WRITE, reversible) → policy `bounded` (L3): it
 *     executes under the run's caps, but all it does is record a PENDING
 *     approval request. A pending request has no downstream effect and can be
 *     rejected/cancelled, so it is genuinely reversible — and it IS the
 *     prepare-and-block mechanism. This is how the agent "does" a high-risk
 *     action: by preparing it for a human, never by executing it.
 *
 *   - `automation.commit_financial` (WRITE, financial) → policy `block` (L2): a
 *     money-movement stand-in the engine refuses to auto-execute. Its executor
 *     throws if ever reached, proving the block happens before execution.
 *
 * The normal handler path PREPARES an action (open_approval) rather than
 * committing it. Executing an *approved* action is a separate, human-initiated
 * step — and for messaging/clearance it also waits on the consent engine / live
 * integrations, which are held for deployment.
 */
@Injectable()
export class AutomationAgent implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly approvals: ApprovalService,
  ) {}

  onModuleInit(): void {
    const openApproval: AgentToolDef = {
      name: 'automation.open_approval',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: record a PENDING approval request for a human to decide. Never executes the action.',
      parameters: {
        type: 'object',
        properties: {
          actionKind: { type: 'string', maxLength: 64, description: 'A short code for the action, e.g. payment_reminder.' },
          title: { type: 'string', maxLength: 200, description: 'Human-readable title for the reviewer.' },
          payload: { type: 'object', description: 'Structured details the reviewer needs to decide.' },
          reversibility: {
            type: 'string',
            enum: ['reversible', 'irreversible', 'financial', 'legal', 'safety'],
            description: 'The class of the underlying action (recorded for the reviewer).',
          },
        },
        additionalProperties: false,
      },
      execute: async (ctx) => {
        const a = (ctx.args ?? {}) as {
          actionKind?: string; title?: string; payload?: Record<string, unknown>; reversibility?: string;
        };
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId,
          runId: ctx.runId,
          agentName: AGENT_AUTOMATION,
          actionKind: a.actionKind ?? 'unspecified',
          title: a.title ?? 'Prepared action awaiting approval',
          payload: a.payload ?? {},
          reversibility: a.reversibility ?? 'irreversible',
          requestedBy: ctx.actorUserId,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    const commitFinancial: AgentToolDef = {
      name: 'automation.commit_financial',
      kind: 'write',
      reversibility: 'financial',
      permission: 'receipts.create',
      description: 'Financial-class stand-in: MUST be blocked by policy and never auto-execute.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        throw new Error('SAFETY VIOLATION: a financial action executed without approval');
      },
    };

    // M5 — assisted compliance: PREPARE India IRN / e-way payloads for approval.
    // Preparing is a reversible write; the underlying action's class ('legal') is
    // recorded on the approval request for the reviewer. No IRP/e-way API call.
    const prepareEinvoice: AgentToolDef = {
      name: 'automation.prepare_einvoice',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: PREPARE an India e-invoice (IRN) payload for approval. No IRP call.',
      parameters: {
        type: 'object',
        properties: { invoiceId: { type: 'string', description: 'UUID of the invoice to prepare an IRN payload for.' } },
        required: ['invoiceId'],
        additionalProperties: false,
      },
      execute: async (ctx) => {
        const inv = await loadInvoice(ctx);
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId, runId: ctx.runId, agentName: AGENT_AUTOMATION,
          actionKind: 'einvoice_irn', title: `Generate IRN for ${inv.invoiceNo}`,
          payload: buildEinvoicePayload(inv as never), reversibility: 'legal',
          requestedBy: ctx.actorUserId,
          entityType: 'invoice', entityId: inv.id as string,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    const prepareEway: AgentToolDef = {
      name: 'automation.prepare_eway',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: PREPARE an India e-way-bill (Part-A) payload for approval. No e-way call.',
      parameters: {
        type: 'object',
        properties: { invoiceId: { type: 'string', description: 'UUID of the invoice to prepare an e-way payload for.' } },
        required: ['invoiceId'],
        additionalProperties: false,
      },
      execute: async (ctx) => {
        const inv = await loadInvoice(ctx);
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId, runId: ctx.runId, agentName: AGENT_AUTOMATION,
          actionKind: 'eway_bill', title: `Generate e-way bill for ${inv.invoiceNo}`,
          payload: buildEwayPayload(inv as never), reversibility: 'legal',
          requestedBy: ctx.actorUserId,
          entityType: 'invoice', entityId: inv.id as string,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    // M5 — assisted compliance: PREPARE a cancellation of an already-generated IRN /
    // e-way for approval. Cancelling is a separate legal action (the 24h-window
    // correction path), so it gets its OWN approval — never folded into anything
    // else. The reference to cancel lives on the invoice; the tool carries the
    // human-chosen reason code (1–4) + remarks. No IRP/e-way API call.
    const prepareEinvoiceCancel: AgentToolDef = {
      name: 'automation.prepare_einvoice_cancel',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: PREPARE a cancellation of an IRN for approval (within 24h). No IRP call.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'UUID of the invoice whose IRN should be cancelled.' },
          reasonCode: { type: 'string', description: 'Cancellation reason: 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Other.' },
          remarks: { type: 'string', maxLength: 100, description: 'Free-text remarks for the cancellation.' },
        },
        required: ['invoiceId', 'reasonCode'],
        additionalProperties: false,
      },
      execute: async (ctx) => {
        const inv = await loadInvoice(ctx);
        const a = (ctx.args ?? {}) as { reasonCode?: string; remarks?: string };
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId, runId: ctx.runId, agentName: AGENT_AUTOMATION,
          actionKind: 'einvoice_cancel', title: `Cancel IRN for ${inv.invoiceNo}`,
          payload: buildEinvoiceCancelPayload(inv as never, a.reasonCode, a.remarks), reversibility: 'legal',
          requestedBy: ctx.actorUserId,
          entityType: 'invoice', entityId: inv.id as string,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    const prepareEwayCancel: AgentToolDef = {
      name: 'automation.prepare_eway_cancel',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: PREPARE a cancellation of an e-way bill for approval (within 24h). No e-way call.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'UUID of the invoice whose e-way bill should be cancelled.' },
          reasonCode: { type: 'string', description: 'Cancellation reason: 1=Duplicate, 2=Order cancelled, 3=Data entry mistake, 4=Other.' },
          remarks: { type: 'string', maxLength: 100, description: 'Free-text remarks for the cancellation.' },
        },
        required: ['invoiceId', 'reasonCode'],
        additionalProperties: false,
      },
      execute: async (ctx) => {
        const inv = await loadInvoice(ctx);
        const a = (ctx.args ?? {}) as { reasonCode?: string; remarks?: string };
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId, runId: ctx.runId, agentName: AGENT_AUTOMATION,
          actionKind: 'eway_cancel', title: `Cancel e-way bill for ${inv.invoiceNo}`,
          payload: buildEwayCancelPayload(inv as never, a.reasonCode, a.remarks), reversibility: 'legal',
          requestedBy: ctx.actorUserId,
          entityType: 'invoice', entityId: inv.id as string,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    // M5 — assisted compliance: PREPARE an in-place modification of a LIVE e-way
    // bill for approval — a Part-B vehicle change (breakdown/transshipment) or a
    // validity extension (goods still in transit). Each is its own approval; the
    // e-way number is read from the invoice. No e-way API call.
    const prepareEwayUpdateVehicle: AgentToolDef = {
      name: 'automation.prepare_eway_update_vehicle',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: PREPARE an e-way Part-B vehicle update for approval. No e-way call.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'UUID of the invoice whose e-way Part-B vehicle should change.' },
          vehicleNo: { type: 'string', description: 'The new vehicle registration number.' },
          reasonCode: { type: 'string', description: 'Reason: 1=Breakdown, 2=Transshipment, 3=Others, 4=First-time.' },
          remarks: { type: 'string', maxLength: 100, description: 'Free-text remarks for the change.' },
        },
        required: ['invoiceId', 'vehicleNo', 'reasonCode'],
        additionalProperties: false,
      },
      execute: async (ctx) => {
        const inv = await loadInvoice(ctx);
        const a = (ctx.args ?? {}) as { vehicleNo?: string; reasonCode?: string; remarks?: string };
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId, runId: ctx.runId, agentName: AGENT_AUTOMATION,
          actionKind: 'eway_update_vehicle', title: `Update e-way vehicle for ${inv.invoiceNo}`,
          payload: buildEwayUpdateVehiclePayload(inv as never, a.vehicleNo, a.reasonCode, a.remarks), reversibility: 'legal',
          requestedBy: ctx.actorUserId,
          entityType: 'invoice', entityId: inv.id as string,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    const prepareEwayExtend: AgentToolDef = {
      name: 'automation.prepare_eway_extend',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: PREPARE an e-way validity extension for approval. No e-way call.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'UUID of the invoice whose e-way validity should be extended.' },
          remainingDistanceKm: { type: 'number', description: 'Distance (km) still to travel.' },
          reasonCode: { type: 'string', description: 'Reason: 1=Natural calamity, 2=Law&order, 3=Transshipment, 4=Accident, 99=Others.' },
          remarks: { type: 'string', maxLength: 100, description: 'Free-text remarks for the extension.' },
        },
        required: ['invoiceId', 'remainingDistanceKm', 'reasonCode'],
        additionalProperties: false,
      },
      execute: async (ctx) => {
        const inv = await loadInvoice(ctx);
        const a = (ctx.args ?? {}) as { remainingDistanceKm?: number; reasonCode?: string; remarks?: string };
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId, runId: ctx.runId, agentName: AGENT_AUTOMATION,
          actionKind: 'eway_extend', title: `Extend e-way validity for ${inv.invoiceNo}`,
          payload: buildEwayExtendPayload(inv as never, a.remainingDistanceKm, a.reasonCode, a.remarks), reversibility: 'legal',
          requestedBy: ctx.actorUserId,
          entityType: 'invoice', entityId: inv.id as string,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    const complianceTools: Record<string, string> = {
      einvoice: 'automation.prepare_einvoice',
      eway: 'automation.prepare_eway',
      einvoice_cancel: 'automation.prepare_einvoice_cancel',
      eway_cancel: 'automation.prepare_eway_cancel',
      eway_update_vehicle: 'automation.prepare_eway_update_vehicle',
      eway_extend: 'automation.prepare_eway_extend',
    };
    const allTools = [
      openApproval, commitFinancial, prepareEinvoice, prepareEway,
      prepareEinvoiceCancel, prepareEwayCancel, prepareEwayUpdateVehicle, prepareEwayExtend,
    ];
    for (const t of allTools) this.registry.registerTool(t);

    this.registry.registerAgent({
      name: AGENT_AUTOMATION,
      description: 'Prepares reversible/high-risk actions (incl. IRN/e-way generate, cancel, update, extend) for human approval (M4/M5).',
      tools: allTools.map((t) => t.name),
      handler: async (ctx) => {
        const input = ctx.input as {
          actionKind?: string; title?: string; payload?: Record<string, unknown>;
          reversibility?: string; tryCommit?: boolean;
          compliance?: 'einvoice' | 'eway' | 'einvoice_cancel' | 'eway_cancel' | 'eway_update_vehicle' | 'eway_extend';
          invoiceId?: string; reasonCode?: string; remarks?: string;
          vehicleNo?: string; remainingDistanceKm?: number;
        };
        // Demonstrate the hard rule: a financial action is blocked, never auto-run.
        if (input.tryCommit) {
          await ctx.callTool('automation.commit_financial', {}); // throws ACTION_BLOCKED → run 'blocked'
        }
        // M5 — prepare a compliance payload (generate / cancel / update / extend) for approval.
        const complianceTool = input.compliance ? complianceTools[input.compliance] : undefined;
        if (complianceTool) {
          const prepared = await ctx.callTool(complianceTool, {
            invoiceId: input.invoiceId, reasonCode: input.reasonCode, remarks: input.remarks,
            vehicleNo: input.vehicleNo, remainingDistanceKm: input.remainingDistanceKm,
          });
          await ctx.note(`automation: prepared ${input.compliance} for approval`);
          return { prepared };
        }
        // The default path: PREPARE a generic action for a human instead of executing it.
        const prepared = await ctx.callTool('automation.open_approval', {
          actionKind: input.actionKind ?? 'payment_reminder',
          title: input.title ?? 'Payment reminder (prepared)',
          payload: input.payload ?? {},
          reversibility: input.reversibility ?? 'irreversible',
        });
        await ctx.note('automation: prepared an action for human approval');
        return { prepared };
      },
    });
  }
}
