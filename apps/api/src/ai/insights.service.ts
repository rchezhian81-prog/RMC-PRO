import { Injectable } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';
import { AiDataService } from './ai-data.service';

const SYSTEM = `You are an operations analyst for an Indian ready-mix concrete (RMC) plant. You are given a JSON snapshot of the plant's current state. Write 3–5 short, specific bullet points the plant owner should notice today.

Cover, only where the data warrants it:
- Large receivables — name the customer and the ₹ amount.
- Materials to reorder — anything at a low or negative balance (negative means over-consumed).
- Orders stuck on credit hold.
- This month's sales value.

Rules: one line per bullet, each starting with "• ". Use ₹ with Indian digit grouping. Be specific with real numbers from the snapshot; never invent figures. No preamble, no headings, no closing remark. If nothing stands out, reply exactly: "Operations look normal — nothing urgent right now."`;

@Injectable()
export class InsightsService {
  constructor(
    private readonly ai: AnthropicService,
    private readonly data: AiDataService,
  ) {}

  async generate(tenantId: string): Promise<{ insights: string; generatedAt: string }> {
    const client = this.ai.require();
    const snapshot = await this.data.snapshot(tenantId);
    const res = await client.messages.create({
      model: this.ai.model,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: this.ai.effort('low'),
      messages: [{ role: 'user', content: `Live snapshot of the plant (JSON):\n${JSON.stringify(snapshot)}` }],
    });
    return { insights: AnthropicService.textOf(res), generatedAt: new Date().toISOString() };
  }
}
