import { Module } from '@nestjs/common';
import { FeatureDemoController } from './feature-demo.controller';
import { ModuleGuard } from '../rbac/module.guard';

@Module({
  controllers: [FeatureDemoController],
  providers: [ModuleGuard],
})
export class DemoModule {}
