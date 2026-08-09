import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { AiController } from './ai.controller';
import { AnthropicService } from './anthropic.service';
import { AiDataService } from './ai-data.service';
import { AssistantService } from './assistant.service';
import { InsightsService } from './insights.service';
import { DraftingService } from './drafting.service';
import { VisionService } from './vision.service';

/**
 * AI features (Phase-4), all on one Anthropic client read from the server env
 * (ANTHROPIC_API_KEY / ANTHROPIC_MODEL). With no key set, the endpoints report
 * disabled and the app runs normally.
 *   - Assistant: chat over the tenant's data via read-only, RLS-scoped tools.
 *   - Insights:  plain-language summary of the plant's current state.
 *   - Drafting:  payment reminders, quotation terms, WhatsApp updates.
 */
@Module({
  controllers: [AiController],
  providers: [
    AnthropicService,
    AiDataService,
    AssistantService,
    InsightsService,
    DraftingService,
    VisionService,
    TenantGuard,
  ],
})
export class AiModule {}
