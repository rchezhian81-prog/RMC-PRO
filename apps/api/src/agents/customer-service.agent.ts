import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { num } from './insights.util';
import type { AgentToolDef } from './agent.types';

export const AGENT_CUSTOMER_SERVICE = 'customer-service';

/**
 * The Customer-Service agent (M3) — the customer-facing surface, and deliberately
 * the LEAST-privileged agent. It answers questions about ONE customer's own data
 * and nothing else. Two access-control layers apply, not one:
 *   1. tenant RLS (every query runs inside runInTenant), and
 *   2. customer-scoping — every tool REQUIRES a customerId and filters by it, so
 *      the agent cannot read another customer's rows even within the same tenant.
 *
 * Untrusted-input posture (WR-AGT-7): a customer never supplies a tool name or an
 * instruction. They supply a validated `intent` from a fixed allow-list
 * (`csIntentTool`), which the agent maps to a read tool. When the LLM + free
 * text arrive later, the message stays DATA — this fixed intent→tool map is the
 * seam that keeps it so.
 *
 * M3 is read-only: no order placement (an L2 write, later, once the Automation
 * path exists) and no outbound messaging (needs the consent engine, GW-12).
 */

/** The ONLY intents a customer request may resolve to (fixed allow-list). */
export const CS_INTENTS: Record<string, string> = {
  account_summary: 'cs.account_summary',
  order_status: 'cs.order_status',
};

/** Pure: map a customer-supplied intent to a tool name, or null if unsupported. */
export function csIntentTool(intent: string): string | null {
  return CS_INTENTS[intent] ?? null;
}

@Injectable()
export class CustomerServiceAgent implements OnModuleInit {
  constructor(private readonly registry: ToolRegistryService) {}

  onModuleInit(): void {
    const accountSummary: AgentToolDef = {
      name: 'cs.account_summary',
      kind: 'read',
      reversibility: 'reversible',
      permission: 'customers.view',
      description: "A single customer's account snapshot: open invoices, outstanding, last invoice.",
      execute: async (ctx) => {
        const customerId = requireCustomerId(ctx.args);
        const [c] = await ctx.manager.query(
          `SELECT customer_name AS "customerName" FROM customers WHERE id = $1`,
          [customerId],
        );
        const [ar] = await ctx.manager.query(
          `SELECT count(*)::int AS "openInvoices",
                  coalesce(sum(outstanding_amount), 0) AS outstanding,
                  max(invoice_date) AS "lastInvoiceDate"
             FROM invoices
            WHERE customer_id = $1 AND invoice_status <> 'cancelled' AND outstanding_amount > 0`,
          [customerId],
        );
        return {
          customerId,
          customerName: c?.customerName ?? null,
          openInvoices: num(ar.openInvoices),
          outstanding: num(ar.outstanding),
          lastInvoiceDate: ar.lastInvoiceDate ?? null,
        };
      },
    };

    const orderStatus: AgentToolDef = {
      name: 'cs.order_status',
      kind: 'read',
      reversibility: 'reversible',
      permission: 'customers.view',
      description: "A single customer's recent orders and their statuses.",
      execute: async (ctx) => {
        const customerId = requireCustomerId(ctx.args);
        const rows: Array<Record<string, unknown>> = await ctx.manager.query(
          `SELECT order_no AS "orderNo", order_status AS "status", order_date AS "orderDate"
             FROM orders WHERE customer_id = $1
            ORDER BY created_at DESC LIMIT 20`,
          [customerId],
        );
        return { customerId, orders: rows };
      },
    };

    this.registry.registerTool(accountSummary);
    this.registry.registerTool(orderStatus);
    this.registry.registerAgent({
      name: AGENT_CUSTOMER_SERVICE,
      description: 'Customer-facing, customer-scoped, read-only Q&A (M3).',
      tools: [accountSummary.name, orderStatus.name],
      // Least-privileged: talks to no other agent.
      handler: async (ctx) => {
        const input = ctx.input as { customerId?: string; intent?: string };
        // Customer scope is mandatory — no un-scoped customer-service run.
        if (!input.customerId || typeof input.customerId !== 'string') {
          throw new Error('customer-service requires a customerId (customer scope)');
        }
        const intent = input.intent ?? 'account_summary';
        const toolName = csIntentTool(intent);
        if (!toolName) throw new Error(`unsupported customer-service intent: ${intent}`);
        const result = await ctx.callTool(toolName, { customerId: input.customerId });
        await ctx.note(`customer-service: ${intent}`);
        return { intent, result };
      },
    });
  }
}

/** Enforce customer-scoping at the tool boundary — never run un-scoped. */
function requireCustomerId(args: unknown): string {
  const id = (args as { customerId?: unknown })?.customerId;
  if (!id || typeof id !== 'string') {
    throw new Error('customer-scoped tool requires a customerId');
  }
  return id;
}
