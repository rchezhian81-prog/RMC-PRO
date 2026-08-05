import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from './anthropic.service';
import { AiDataService } from './ai-data.service';

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

  constructor(
    private readonly ai: AnthropicService,
    private readonly data: AiDataService,
  ) {}

  private clamp(n: unknown, def: number, max: number): number {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : def;
  }

  private async runTool(tenantId: string, name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'get_business_summary':
        return JSON.stringify(await this.data.businessSummary(tenantId));
      case 'list_top_outstanding':
        return JSON.stringify(await this.data.topOutstanding(tenantId, this.clamp(input.limit, 5, 20)));
      case 'list_low_stock':
        return JSON.stringify(await this.data.lowStock(tenantId, this.clamp(input.limit, 8, 30)));
      case 'list_recent_orders':
        return JSON.stringify(
          await this.data.recentOrders(tenantId, input.status ? String(input.status) : null, this.clamp(input.limit, 10, 30)),
        );
      default:
        return `Unknown tool: ${name}`;
    }
  }

  /** Answer a chat turn using tool-augmented lookups over this tenant's data. */
  async chat(tenantId: string, history: ChatTurn[]): Promise<{ reply: string }> {
    const client = this.ai.require();
    const messages: Anthropic.MessageParam[] = history
      .filter((t) => t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }));
    if (!messages.length) {
      return { reply: 'Ask me about your plant — outstanding, stock, recent orders, or an overview.' };
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await client.messages.create({
        model: this.ai.model,
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

      return { reply: AnthropicService.textOf(res) || '(no answer)' };
    }
    return { reply: 'That needed too many lookups — please narrow the question.' };
  }
}
