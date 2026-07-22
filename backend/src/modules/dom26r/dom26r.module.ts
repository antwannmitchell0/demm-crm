import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { Dom26rAuditService } from './dom26r-audit.service';
import { RelationshipProfileService } from './relationship-profile.service';
import { EngramService } from './engram.service';
import { EngramController } from './engram.controller';
import { MemoryCandidateService } from './memory-candidate.service';
import { MemoryCandidateController } from './memory-candidate.controller';
import { ConsentDirectiveService } from './consent-directive.service';
import { ConsentDirectiveController } from './consent-directive.controller';
import { RelationshipBriefService } from './relationship-brief.service';
import { RelationshipBriefController } from './relationship-brief.controller';

@Module({
  controllers: [
    EngramController,
    MemoryCandidateController,
    ConsentDirectiveController,
    RelationshipBriefController,
  ],
  providers: [
    PrismaService,
    BusinessUnitGuard,
    Dom26rAuditService,
    RelationshipProfileService,
    EngramService,
    MemoryCandidateService,
    ConsentDirectiveService,
    RelationshipBriefService,
  ],
  exports: [
    Dom26rAuditService,
    RelationshipProfileService,
    EngramService,
    MemoryCandidateService,
    ConsentDirectiveService,
    RelationshipBriefService,
  ],
})
export class Dom26rModule {}
