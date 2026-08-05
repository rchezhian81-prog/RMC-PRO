import { BadRequestException, Injectable } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';

export type DraftKind = 'payment_reminder' | 'quotation_terms' | 'whatsapp_update' | 'custom';

const GUIDE: Record<DraftKind, string> = {
  payment_reminder:
    'Draft a short, polite payment-reminder message from an Indian ready-mix concrete supplier to a customer, suitable to send on WhatsApp or SMS. Reference the outstanding amount and request payment at their earliest convenience. Warm and professional, not aggressive. Under 60 words. Return only the message text — no subject line, no quotes.',
  quotation_terms:
    'Draft the standard Terms & Conditions for an Indian ready-mix concrete quotation, as short bullet points: price validity, GST extra as applicable, payment terms, pumping/placing charges if any, site access and continuous pour responsibility of the buyer, and waiting/demurrage. Keep it concise and business-standard. Return only the bullet list.',
  whatsapp_update:
    'Draft a brief, friendly WhatsApp status update to a customer about their concrete order/delivery, using the details provided. Under 45 words, plain and clear. Return only the message text.',
  custom:
    'Write the requested business text for an Indian ready-mix concrete plant. Keep it concise and professional. Return only the text.',
};

@Injectable()
export class DraftingService {
  constructor(private readonly ai: AnthropicService) {}

  async draft(
    kind: DraftKind,
    context: Record<string, unknown> = {},
    instructions?: string,
  ): Promise<{ text: string }> {
    const client = this.ai.require();
    const guide = GUIDE[kind];
    if (!guide) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `Unknown draft kind: ${kind}` });

    const parts = [guide];
    if (instructions?.trim()) parts.push(`Additional instruction from the user: ${instructions.trim()}`);
    parts.push(`Details to use (JSON):\n${JSON.stringify(context)}`);

    const res = await client.messages.create({
      model: this.ai.model,
      max_tokens: 800,
      system:
        'You draft short business documents and messages for an Indian ready-mix concrete plant. Use only the details provided; do not invent names, amounts, or dates. Output only the requested text, ready to copy — no preamble, no explanation, no markdown code fences.',
      output_config: this.ai.effort('low'),
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    });
    return { text: AnthropicService.textOf(res) };
  }
}
