import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { Dom26rModule } from '../dom26r/dom26r.module';
import { OfferService } from './offer.service';
import { OfferController } from './offer.controller';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { MarketingRelationshipService } from './marketing-relationship.service';

@Module({
  imports: [Dom26rModule],
  controllers: [OfferController, LeadController],
  providers: [
    PrismaService,
    BusinessUnitGuard,
    OfferService,
    LeadService,
    MarketingRelationshipService,
  ],
  exports: [OfferService, LeadService, MarketingRelationshipService],
})
export class MarketingModule {}
