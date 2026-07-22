import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { OfferService } from './offer.service';
import { OfferController } from './offer.controller';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';

@Module({
  controllers: [OfferController, LeadController],
  providers: [PrismaService, BusinessUnitGuard, OfferService, LeadService],
  exports: [OfferService, LeadService],
})
export class MarketingModule {}
