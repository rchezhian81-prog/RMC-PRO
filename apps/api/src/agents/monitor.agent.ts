import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { num, stockSeverity } from './insights.util';
import type { AgentToolDef } from './agent.types';

export const AGENT_MONITOR = 'monitor';

/**
 * The Monitor agent (M1) — read-only watchtower. It runs operational threshold
 * checks over the tenant's own data and returns a list of ALERTS. It only
 * detects and reports: it never remediates (opening incidents / approvals is a
 * write, and belongs to a later wave). Separation of duties — the watcher cannot
 * change what it watches — is enforced structurally: `monitor.checks` is a read
 * tool, so the policy engine and the tool registry give it no write path at all.
 */
@Injectable()
export class MonitorAgent implements OnModuleInit {
  constructor(private readonly registry: ToolRegistryService) {}

  onModuleInit(): void {
    const checks: AgentToolDef = {
      name: 'monitor.checks',
      kind: 'read',
      reversibility: 'reversible',
      permission: 'reports.view',
      description: 'Operational threshold checks → alerts: overdue AR, credit-limit breach, low stock.',
      execute: async (ctx) => {
        const threshold = num((ctx.args as { stockThreshold?: unknown })?.stockThreshold);
        const alerts: Array<Record<string, unknown>> = [];

        // 1) Overdue receivables — unpaid invoices past their due date.
        const [ar] = await ctx.manager.query(
          `SELECT count(*)::int AS count, coalesce(sum(outstanding_amount), 0) AS total
             FROM invoices
            WHERE invoice_status <> 'cancelled' AND outstanding_amount > 0
              AND due_date IS NOT NULL AND due_date < current_date`,
        );
        if (num(ar.count) > 0) {
          alerts.push({
            code: 'overdue_ar', severity: 'warn',
            message: `${num(ar.count)} overdue invoice(s); ${num(ar.total)} outstanding`,
            detail: { count: num(ar.count), totalOutstanding: num(ar.total) },
          });
        }

        // 2) Credit-limit breach — a customer's open outstanding exceeds its limit.
        const breaches: Array<Record<string, unknown>> = await ctx.manager.query(
          `SELECT c.id AS "customerId", c.customer_name AS "customerName",
                  c.credit_limit AS "creditLimit",
                  coalesce(sum(i.outstanding_amount), 0) AS outstanding
             FROM customers c
             JOIN invoices i ON i.customer_id = c.id
              AND i.invoice_status <> 'cancelled' AND i.outstanding_amount > 0
            WHERE c.credit_limit > 0
            GROUP BY c.id, c.customer_name, c.credit_limit
           HAVING coalesce(sum(i.outstanding_amount), 0) > c.credit_limit
            ORDER BY outstanding DESC
            LIMIT 20`,
        );
        if (breaches.length) {
          alerts.push({
            code: 'credit_limit_breach', severity: 'warn',
            message: `${breaches.length} customer(s) over credit limit`,
            detail: {
              customers: breaches.map((b) => ({
                ...b, outstanding: num(b.outstanding), creditLimit: num(b.creditLimit),
              })),
            },
          });
        }

        // 3) Low / negative stock — balances at or below the alert threshold.
        const low: Array<Record<string, unknown>> = await ctx.manager.query(
          `SELECT plant_id AS "plantId", material_id AS "materialId",
                  coalesce(material_label, '') AS "materialLabel",
                  current_quantity AS qty, uom
             FROM stock_balances WHERE current_quantity <= $1
            ORDER BY current_quantity ASC LIMIT 50`,
          [threshold],
        );
        if (low.length) {
          alerts.push({
            code: 'low_stock',
            severity: low.some((r) => num(r.qty) < 0) ? 'critical' : 'warn',
            message: `${low.length} material balance(s) at/below ${threshold}`,
            detail: { items: low.map((r) => ({ ...r, qty: num(r.qty), severity: stockSeverity(num(r.qty)) })) },
          });
        }

        return { alerts, alertCount: alerts.length, threshold };
      },
    };

    this.registry.registerTool(checks);
    this.registry.registerAgent({
      name: AGENT_MONITOR,
      description: 'Read-only operational watchtower (M1).',
      tools: [checks.name],
      handler: async (ctx) => {
        const input = ctx.input as { stockThreshold?: number };
        const r = await ctx.callTool<{ alertCount: number }>('monitor.checks', {
          stockThreshold: input.stockThreshold,
        });
        await ctx.note(`monitor: ${r.alertCount} alert(s)`);
        return r;
      },
    });
  }
}
