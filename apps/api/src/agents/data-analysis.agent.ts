import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { clampInt, num } from './insights.util';
import type { AgentToolDef } from './agent.types';

export const AGENT_DATA_ANALYSIS = 'data-analysis';

/**
 * The Data-Analysis agent (M1) — read-only. It turns the tenant's own order,
 * invoice and payment data into a KPI snapshot and a top-customers ranking.
 * Both tools are READS, so the policy engine executes them freely (L1), and the
 * kernel runs each inside `runInTenant` — the queries physically cannot see
 * another tenant's rows. No writes, no LLM: the first real agent riding the M0
 * substrate.
 *
 * Every tool declares the human-equivalent RBAC permission (`reports.view`) as
 * metadata for parity/audit; the run itself is gated at the controller by
 * `agents.manage`.
 */
@Injectable()
export class DataAnalysisAgent implements OnModuleInit {
  constructor(private readonly registry: ToolRegistryService) {}

  onModuleInit(): void {
    const summary: AgentToolDef = {
      name: 'analysis.summary',
      kind: 'read',
      reversibility: 'reversible',
      permission: 'reports.view',
      description: 'KPI snapshot for a window: orders, invoiced revenue/tax, receipts, outstanding.',
      execute: async (ctx) => {
        const days = clampInt((ctx.args as { windowDays?: unknown })?.windowDays, 30, 1, 365);
        const [orders] = await ctx.manager.query(
          `SELECT count(*)::int AS count, coalesce(sum(estimated_order_value), 0) AS value
             FROM orders WHERE created_at >= now() - make_interval(days => $1)`,
          [days],
        );
        const [inv] = await ctx.manager.query(
          `SELECT count(*)::int AS count,
                  coalesce(sum(total_amount), 0)   AS revenue,
                  coalesce(sum(taxable_amount), 0) AS taxable,
                  coalesce(sum(cgst_amount + sgst_amount + igst_amount + cess_amount), 0) AS tax
             FROM invoices
            WHERE invoice_status <> 'cancelled' AND created_at >= now() - make_interval(days => $1)`,
          [days],
        );
        const [rec] = await ctx.manager.query(
          `SELECT coalesce(sum(amount), 0) AS receipts
             FROM payments WHERE status = 'posted' AND created_at >= now() - make_interval(days => $1)`,
          [days],
        );
        // Outstanding is an "as-of-now" figure, not windowed.
        const [out] = await ctx.manager.query(
          `SELECT count(*)::int AS count, coalesce(sum(outstanding_amount), 0) AS total
             FROM invoices WHERE invoice_status <> 'cancelled' AND outstanding_amount > 0`,
        );
        return {
          windowDays: days,
          orders: { count: num(orders.count), estimatedValue: num(orders.value) },
          invoices: {
            count: num(inv.count), revenue: num(inv.revenue),
            taxable: num(inv.taxable), tax: num(inv.tax),
          },
          receipts: num(rec.receipts),
          outstanding: { invoices: num(out.count), total: num(out.total) },
        };
      },
    };

    const topCustomers: AgentToolDef = {
      name: 'analysis.top_customers',
      kind: 'read',
      reversibility: 'reversible',
      permission: 'reports.view',
      description: 'Top customers by invoiced revenue in a window.',
      execute: async (ctx) => {
        const a = (ctx.args ?? {}) as { windowDays?: unknown; topN?: unknown };
        const days = clampInt(a.windowDays, 30, 1, 365);
        const topN = clampInt(a.topN, 5, 1, 50);
        const rows: Array<Record<string, unknown>> = await ctx.manager.query(
          `SELECT i.customer_id AS "customerId",
                  coalesce(c.customer_name, '(unknown)') AS "customerName",
                  count(*)::int AS invoices,
                  coalesce(sum(i.total_amount), 0) AS revenue
             FROM invoices i
             LEFT JOIN customers c ON c.id = i.customer_id
            WHERE i.invoice_status <> 'cancelled' AND i.created_at >= now() - make_interval(days => $1)
            GROUP BY i.customer_id, c.customer_name
            ORDER BY revenue DESC NULLS LAST
            LIMIT $2`,
          [days, topN],
        );
        return rows.map((r) => ({ ...r, revenue: num(r.revenue), invoices: num(r.invoices) }));
      },
    };

    this.registry.registerTool(summary);
    this.registry.registerTool(topCustomers);
    this.registry.registerAgent({
      name: AGENT_DATA_ANALYSIS,
      description: 'Read-only analytics / KPIs (M1).',
      tools: [summary.name, topCustomers.name],
      handler: async (ctx) => {
        const input = ctx.input as { windowDays?: number; topN?: number };
        const s = await ctx.callTool('analysis.summary', { windowDays: input.windowDays });
        await ctx.note('data-analysis: KPI summary computed');
        const top = await ctx.callTool('analysis.top_customers', {
          windowDays: input.windowDays, topN: input.topN,
        });
        return { summary: s, topCustomers: top };
      },
    });
  }
}
