import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from './anthropic.service';

const ALLOWED_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 12 * 1024 * 1024; // ~12 MB decoded

// Strict JSON schema for the extracted order. Every field is required (nullable
// via type unions) so structured output stays valid.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    customerName: { type: ['string', 'null'] },
    siteName: { type: ['string', 'null'] },
    poNumber: { type: ['string', 'null'] },
    orderDate: { type: ['string', 'null'] },
    deliveryDate: { type: ['string', 'null'] },
    contactMobile: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          grade: { type: ['string', 'null'] },
          quantityM3: { type: ['number', 'null'] },
          rate: { type: ['number', 'null'] },
        },
        required: ['grade', 'quantityM3', 'rate'],
      },
    },
    notes: { type: ['string', 'null'] },
  },
  required: [
    'customerName',
    'siteName',
    'poNumber',
    'orderDate',
    'deliveryDate',
    'contactMobile',
    'items',
    'notes',
  ],
} as const;

const PROMPT =
  'This is a customer purchase order / work order for ready-mix concrete. Extract the order details. List each concrete grade as a separate item with its quantity in cubic metres (m³) and the rate per m³ if shown. Use null for anything not present. Do not guess values that are not on the document.';

@Injectable()
export class VisionService {
  private readonly log = new Logger(VisionService.name);

  constructor(private readonly ai: AnthropicService) {}

  async extractPurchaseOrder(fileBase64: string, mediaType: string): Promise<{ extracted: unknown }> {
    const client = this.ai.require();
    const b64 = (fileBase64 || '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
    if (!b64) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'No file provided.' });
    if (b64.length * 0.75 > MAX_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'File is too large (max ~12 MB).' });
    }

    const isPdf = mediaType === 'application/pdf';
    if (!isPdf && !ALLOWED_IMAGE.includes(mediaType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_TYPE',
        message: 'Upload a PDF or an image (PNG/JPEG/WebP).',
      });
    }

    const fileBlock = isPdf
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/png', data: b64 } };

    // Structured output; effort only where the model supports it.
    const outputConfig: Record<string, unknown> = { format: { type: 'json_schema', schema: SCHEMA } };
    if (this.ai.supportsEffort) outputConfig.effort = 'low';

    const res = await client.messages.create({
      model: this.ai.model,
      max_tokens: 2048,
      system:
        'You extract structured order data from Indian ready-mix concrete purchase orders. Return only data present on the document; never invent values.',
      output_config: outputConfig as Anthropic.MessageCreateParams['output_config'],
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROMPT }] }],
    });

    const text = AnthropicService.textOf(res);
    try {
      return { extracted: JSON.parse(text) };
    } catch {
      this.log.warn('PO extraction did not return valid JSON');
      throw new BadRequestException({
        code: 'EXTRACTION_FAILED',
        message: 'Could not read that document. Try a clearer scan or a different file.',
      });
    }
  }
}
