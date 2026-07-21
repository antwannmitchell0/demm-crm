import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { ContactModule } from '../contact/contact.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [ContactModule, PipelineModule, OpportunityModule, DashboardModule],
  controllers: [AgentController],
  providers: [AgentService, PrismaService],
  exports: [AgentService],
})
export class AgentModule {}
