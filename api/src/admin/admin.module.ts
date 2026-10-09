import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SuperadminGuard } from './superadmin.guard';

@Module({
  controllers: [AdminController],
  providers: [SuperadminGuard],
})
export class AdminModule {}
