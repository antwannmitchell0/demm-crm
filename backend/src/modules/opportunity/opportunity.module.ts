import { Module } from '@nestjs/common';
import { OpportunityService } from './opportunity.service';
import { OpportunityController } from './opportunity.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [OpportunityController],
  providers: [OpportunityService, PrismaService],
  exports: [OpportunityService],
})
export class OpportunityModule {}
