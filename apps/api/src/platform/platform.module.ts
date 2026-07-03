import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SuperAdminGuard } from '../rbac/super-admin.guard';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, SuperAdminGuard],
})
export class PlatformModule {}
