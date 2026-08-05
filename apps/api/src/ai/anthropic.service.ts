import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Thin holder for the Anthropic client. The API key and model are read from the
 * server environment only. With no key set, isConfigured() is false and every
 * feature reports "not configured" instead of crashing the app.
 */
@Injectable()
export class AnthropicService {
  readonly model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  private readonly instance: Anthropic | null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.instance = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.instance !== null;
  }

  /** The client, or a 503 if AI isn't configured. */
  require(): Anthropic {
    if (!this.instance) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: 'The AI features are not set up yet. Set ANTHROPIC_API_KEY on the server to enable them.',
      });
    }
    return this.instance;
  }

  /** Collapse a message response's text blocks into a single string. */
  static textOf(res: Anthropic.Message): string {
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
}
