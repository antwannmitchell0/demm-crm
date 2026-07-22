import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { OfferService } from './offer.service';
import { OfferController } from './offer.controller';

@Module({
  controllers: [OfferController],
  providers: [PrismaService, BusinessUnitGuard, OfferService],
  exports: [OfferService],
})
export class MarketingModule {}
