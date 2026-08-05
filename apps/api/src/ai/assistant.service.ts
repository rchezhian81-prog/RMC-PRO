import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { TenantDbService } from '../core/database/tenant-db.service';

// Model + key come from the server environment only — never the browser, never
// the request. Default per Anthropic guidance; override with ANTHROPIC_MODEL
// (e.g. claude-sonnet-5 / claude-haiku-4-5 for lower cost on a pilot).
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const MAX_TOOL_ROUNDS = 6;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the assistant inside Mix Nova RMC, the operating software for an Indian ready-mix concrete plant. You help plant staff by answering questions about THEIR plant's own live data.

Rules:
- Use the tools to look up real figures. Never invent numbers, customers, or stock — if a tool returns nothing, say so plainly.
- All money is Indian Rupees (₹); format with Indian digit grouping and 2 decimals.
- Be concise and practical: lead with the answer, then a short supporting detail. Prefer a short table only when listing several rows.
- You can read data but cannot change anything. If asked to create or edit records, explain that they should do that on the relevant screen.
- Keep answers to what was asked; don't lecture.`;

// Read-only tools. Each runs a tenant-scoped SELECT inside the caller's RLS
// context, so the assistant can only ever see this tenant's own rows.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_business_summary',
    description:
      'Snapshot of the plant right now: active customers, order counts by status, issued-invoice count, total outstanding receivable, and this-month sales value. Use for "how are we doing / overview" questions.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_top_outstanding',
    description:
      'Customers with the largest unpaid balance on issued invoices, highest first. Use for "who owes us the most / outstanding / receivables" questions.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many customers (default 5, max 20).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_low_stock',
    description:
      'Material stock balances, lowest quantity first (a negative balance means over-consumed). Use for "what are we low on / stock levels" questions.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many materials (default 8, max 30).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_recent_orders',
    description:
      'Most recent orders with their status. Optionally filter by status (draft, confirmed, credit_hold, cancelled). Use for "recent orders / pending orders / what\'s on credit hold" questions.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter.' },
        limit: { type: 'integer', description: 'How many orders (default 10, max 30).' },
      },
      additionalProperties: false,
    },
  },
];

@Injectable()
export class AssistantService {
  private readonly log = new Logger(AssistantService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly db: TenantDbService) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private ensure(): Anthropic {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: 'The AI assistant is not set up yet. Set ANTHROPIC_API_KEY on the server to enable it.',
      });
    }
    return this.client;
  }

  private clamp(n: unknown, def: number, max: number): number {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : def;
  }

  private async runTool(tenantId: string, name: string, input: Record<string, unknown>): Promise<string> {
    return this.db.runInTenant(tenantId, async (m) => {
      switch (name) {
        case 'get_business_summary': {
          const [row] = await m.query(
            `SELECT
               (SELECT count(*) FROM customers WHERE status='active')                                   AS active_customers,
               (SELECT count(*) FROM orders WHERE order_status='confirmed')                              AS confirmed_orders,
               (SELECT count(*) FROM orders WHERE order_status='draft')                                  AS draft_orders,
               (SELECT count(*) FROM orders WHERE order_status='credit_hold')                            AS credit_hold_orders,
               (SELECT count(*) FROM invoices WHERE invoice_status='issued')                             AS issued_invoices,
               (SELECT COALESCE(sum(outstanding_amount),0) FROM invoices WHERE invoice_status='issued')  AS total_outstanding,
               (SELECT COALESCE(sum(total_amount),0) FROM invoices
                  WHERE invoice_status='issued'
                    AND invoice_date IS NOT NULL
                    AND date_trunc('month', invoice_date::date) = date_trunc('month', CURRENT_DATE))     AS sales_this_month`,
          );
          return JSON.stringify(row ?? {});
        }
        case 'list_top_outstanding': {
          const limit = this.clamp(input.limit, 5, 20);
          const rows = await m.query(
            `SELECT c.customer_name, c.customer_code, COALESCE(sum(i.outstanding_amount),0)::float AS outstanding
               FROM invoices i JOIN customers c ON c.id = i.customer_id
              WHERE i.invoice_status='issued' AND i.outstanding_amount > 0
              GROUP BY c.id, c.customer_name, c.customer_code
              ORDER BY outstanding DESC
              LIMIT $1`,
            [limit],
          );
          return JSON.stringify(rows);
        }
        case 'list_low_stock': {
          const limit = this.clamp(input.limit, 8, 30);
          const rows = await m.query(
            `SELECT material_label, current_quantity::float AS quantity, uom
               FROM stock_balances
              ORDER BY current_quantity ASC
              LIMIT $1`,
            [limit],
          );
          return JSON.stringify(rows);
        }
        case 'list_recent_orders': {
          const limit = this.clamp(input.limit, 10, 30);
          const status = input.status ? String(input.status) : null;
          const rows = await m.query(
            `SELECT order_no, order_date, order_status
               FROM orders
              WHERE ($1::text IS NULL OR order_status = $1)
              ORDER BY created_at DESC
              LIMIT $2`,
            [status, limit],
          );
          return JSON.stringify(rows);
        }
        default:
          return `Unknown tool: ${name}`;
      }
    });
  }

  /** Answer a chat turn using tool-augmented lookups over this tenant's data. */
  async chat(tenantId: string, history: ChatTurn[]): Promise<{ reply: string }> {
    const client = this.ensure();
    const messages: Anthropic.MessageParam[] = history
      .filter((t) => t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }));
    if (!messages.length) return { reply: 'Ask me about your plant — outstanding, stock, recent orders, or an overview.' };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        output_config: { effort: 'low' },
        messages,
      });

      if (res.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: res.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of res.content) {
          if (block.type !== 'tool_use') continue;
          let out: string;
          try {
            out = await this.runTool(tenantId, block.name, (block.input ?? {}) as Record<string, unknown>);
          } catch (e) {
            this.log.warn(`tool ${block.name} failed: ${e instanceof Error ? e.message : e}`);
            out = 'Error: could not fetch that data.';
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: out });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply: text || '(no answer)' };
    }
    return { reply: 'That needed too many lookups — please narrow the question.' };
  }
}
