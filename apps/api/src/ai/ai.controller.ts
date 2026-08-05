import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { AssistantService, type ChatTurn } from './assistant.service';

@Controller('ai')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AiController {
  constructor(private readonly assistant: AssistantService) {}

  /** Whether the AI features are switched on (an API key is configured). */
  @Get('status')
  status() {
    return { enabled: this.assistant.isConfigured() };
  }

  /** Ask the operational assistant a question about this tenant's data. */
  @Post('assistant/chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  chat(@CurrentUser() u: AuthUser, @Body() body: { messages?: ChatTurn[] }) {
    return this.assistant.chat(u.tenantId as string, Array.isArray(body?.messages) ? body.messages : []);
  }
}
