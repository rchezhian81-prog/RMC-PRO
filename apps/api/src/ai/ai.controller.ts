import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { AnthropicService } from './anthropic.service';
import { AssistantService, type ChatTurn } from './assistant.service';
import { InsightsService } from './insights.service';
import { DraftingService, type DraftKind } from './drafting.service';

@Controller('ai')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AiController {
  constructor(
    private readonly ai: AnthropicService,
    private readonly assistant: AssistantService,
    private readonly insights: InsightsService,
    private readonly drafting: DraftingService,
  ) {}

  /** Whether the AI features are switched on (an API key is configured). */
  @Get('status')
  status() {
    return { enabled: this.ai.isConfigured() };
  }

  /** Ask the operational assistant a question about this tenant's data. */
  @Post('assistant/chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  chat(@CurrentUser() u: AuthUser, @Body() body: { messages?: ChatTurn[] }) {
    return this.assistant.chat(u.tenantId as string, Array.isArray(body?.messages) ? body.messages : []);
  }

  /** Plain-language insights on the plant's current state. */
  @Get('insights')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  getInsights(@CurrentUser() u: AuthUser) {
    return this.insights.generate(u.tenantId as string);
  }

  /** Draft a message/document (payment reminder, quotation terms, etc.). */
  @Post('draft')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  draft(
    @Body() body: { kind?: DraftKind; context?: Record<string, unknown>; instructions?: string },
  ) {
    return this.drafting.draft(body?.kind ?? 'custom', body?.context ?? {}, body?.instructions);
  }
}
