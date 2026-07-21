import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { ContactModule } from './modules/contact/contact.module';
import { CompanyModule } from './modules/company/company.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { TaskModule } from './modules/task/task.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AgentModule } from './modules/agent/agent.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    AuthModule,
    WorkspaceModule,
    ContactModule,
    CompanyModule,
    PipelineModule,
    OpportunityModule,
    TaskModule,
    DashboardModule,
    AgentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
