import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { AiController } from './ai.controller';
import { AssistantService } from './assistant.service';

/**
 * AI features (Phase-4). The operational assistant answers questions over the
 * tenant's own data via read-only, RLS-scoped tools. The Anthropic API key and
 * model are read from the server environment (ANTHROPIC_API_KEY / ANTHROPIC_MODEL);
 * with no key set, the endpoints report disabled instead of erroring the app.
 */
@Module({
  controllers: [AiController],
  providers: [AssistantService, TenantGuard],
})
export class AiModule {}
