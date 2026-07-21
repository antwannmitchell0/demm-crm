import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { ContactModule } from './modules/contact/contact.module';
import { CompanyModule } from './modules/company/company.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AgentModule } from './modules/agent/agent.module';
import { TaskModule } from './modules/task/task.module';

@Module({
  imports: [
    AuthModule,
    WorkspaceModule,
    ContactModule,
    CompanyModule,
    PipelineModule,
    OpportunityModule,
    DashboardModule,
    AgentModule,
    TaskModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
