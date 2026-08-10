import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { clampInt, num } from './insights.util';
import type { AgentToolDef } from './agent.types';

export const AGENT_SPECIALIST = 'specialist';

/**
 * The Specialist agent (M2) — the advisory "expert council" other agents escalate
 * to for deep reasoning. Read-only: it produces recommendations WITH a cited
 * rule/standard, and by design it acts on nothing. Its architectural ceiling is
 * hard-L2 (a human must approve before any recommendation is acted on), which in
 * M2 is guaranteed structurally: every tool is a `read`, and the agent escalates
 * to no one (`canEscalateTo: []`).
 *
 * Two expert lenses over the tenant's own data, each citing the worldwide
 * requirements corpus:
 *   - compliance_review — India GST e-invoice / e-way / HSN readiness gaps.
 *   - ar_risk           — accounts-receivable risk (overdue + over-limit).
 */
@Injectable()
export class SpecialistAgent implements OnModuleInit {
  constructor(private readonly registry: ToolRegistryService) {}

  onModuleInit(): void {
    const compliance: AgentToolDef = {
      name: 'specialist.compliance_review',
      kind: 'read',
      reversibility: 'reversible',
      permission: 'reports.view',
      description: 'Advisory: India GST e-invoice / e-way / HSN readiness gaps on recent invoices, with cited recommendations.',
      execute: async (ctx) => {
        const days = clampInt((ctx.args as { windowDays?: unknown })?.windowDays, 30, 1, 365);
        const findings: Array<Record<string, unknown>> = [];

        const [irn] = await ctx.manager.query(
          `SELECT count(*)::int AS count FROM invoices
            WHERE invoice_status NOT IN ('draft', 'cancelled') AND einvoice_status = 'not_generated'
              AND created_at >= now() - make_interval(days => $1)`,
          [days],
        );
        if (num(irn.count) > 0) {
          findings.push({
            code: 'einvoice_pending', severity: 'warn', count: num(irn.count),
            recommendation: 'Generate the IRN via the IRP before the invoice is legally issued/dispatched.',
            citation: 'India GST e-invoice (IRP/IRN), AATO > ₹5 cr — WR-TAX-12 / IND-02',
          });
        }

        const [eway] = await ctx.manager.query(
          `SELECT count(*)::int AS count FROM invoices
            WHERE invoice_status NOT IN ('draft', 'cancelled') AND eway_status = 'not_generated'
              AND total_amount > 50000 AND created_at >= now() - make_interval(days => $1)`,
          [days],
        );
        if (num(eway.count) > 0) {
          findings.push({
            code: 'eway_pending', severity: 'warn', count: num(eway.count),
            recommendation: 'Generate the e-way bill (Part A + Part B) before the vehicle moves; consignment value > ₹50,000.',
            citation: 'India e-way bill threshold ₹50k — WR-TAX-13 / IND-07',
          });
        }

        const [hsn] = await ctx.manager.query(
          `SELECT count(*)::int AS count FROM invoice_items it
             JOIN invoices i ON i.id = it.invoice_id
            WHERE i.invoice_status NOT IN ('draft', 'cancelled')
              AND i.created_at >= now() - make_interval(days => $1)
              AND (it.hsn_sac IS NULL OR btrim(it.hsn_sac) = '')`,
          [days],
        );
        if (num(hsn.count) > 0) {
          findings.push({
            code: 'hsn_missing', severity: 'warn', count: num(hsn.count),
            recommendation: 'Populate a valid 6-digit HSN/SAC on every line; clearance portals reject missing codes.',
            citation: 'India HSN 6-digit at AATO > ₹5 cr — WR-TAX-7 / IND-05',
          });
        }

        return { topic: 'compliance', windowDays: days, findings, findingCount: findings.length };
      },
    };

    const arRisk: AgentToolDef = {
      name: 'specialist.ar_risk',
      kind: 'read',
      reversibility: 'reversible',
      permission: 'reports.view',
      description: 'Advisory: accounts-receivable risk (overdue exposure + over-limit customers) with cited recommendations.',
      execute: async (ctx) => {
        const findings: Array<Record<string, unknown>> = [];

        const [overdue] = await ctx.manager.query(
          `SELECT count(*)::int AS count, coalesce(sum(outstanding_amount), 0) AS total FROM invoices
            WHERE invoice_status <> 'cancelled' AND outstanding_amount > 0
              AND due_date IS NOT NULL AND due_date < current_date`,
        );
        if (num(overdue.count) > 0) {
          findings.push({
            code: 'overdue_exposure', severity: 'warn',
            count: num(overdue.count), total: num(overdue.total),
            recommendation: 'Prioritise collections on overdue invoices; consider a dunning sequence.',
            citation: 'Credit control / DSO (RMC AR runs 45–75 days) — WR-FIN-15',
          });
        }

        const overLimit: Array<Record<string, unknown>> = await ctx.manager.query(
          `SELECT c.customer_name AS "customerName", c.credit_limit AS "creditLimit",
                  coalesce(sum(i.outstanding_amount), 0) AS outstanding
             FROM customers c
             JOIN invoices i ON i.customer_id = c.id
              AND i.invoice_status <> 'cancelled' AND i.outstanding_amount > 0
            WHERE c.credit_limit > 0
            GROUP BY c.id, c.customer_name, c.credit_limit
           HAVING coalesce(sum(i.outstanding_amount), 0) > c.credit_limit
            ORDER BY outstanding DESC LIMIT 10`,
        );
        if (overLimit.length) {
          findings.push({
            code: 'over_limit_customers', severity: 'warn',
            customers: overLimit.map((r) => ({ ...r, outstanding: num(r.outstanding), creditLimit: num(r.creditLimit) })),
            recommendation: 'Review credit hold for customers whose open outstanding exceeds their limit before new dispatch.',
            citation: 'Auto credit-hold on over-limit — WR-FIN-15',
          });
        }

        return { topic: 'ar_risk', findings, findingCount: findings.length };
      },
    };

    this.registry.registerTool(compliance);
    this.registry.registerTool(arRisk);
    this.registry.registerAgent({
      name: AGENT_SPECIALIST,
      description: 'Advisory expert council — read-only, cited recommendations (M2).',
      tools: [compliance.name, arRisk.name],
      canEscalateTo: [], // the council escalates to no one
      handler: async (ctx) => {
        const input = ctx.input as { topic?: string; windowDays?: number };
        const topic = input.topic ?? 'all';
        const out: Record<string, unknown> = { topic };
        if (topic === 'compliance' || topic === 'all') {
          out.compliance = await ctx.callTool('specialist.compliance_review', { windowDays: input.windowDays });
        }
        if (topic === 'ar_risk' || topic === 'all') {
          out.arRisk = await ctx.callTool('specialist.ar_risk', { windowDays: input.windowDays });
        }
        await ctx.note(`specialist: advisory on ${topic}`);
        return out;
      },
    });
  }
}
