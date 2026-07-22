import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { Dom26rModule } from '../dom26r/dom26r.module';
import { OfferService } from './offer.service';
import { OfferController } from './offer.controller';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { MarketingRelationshipService } from './marketing-relationship.service';
import { ClientAccountService } from './client-account.service';
import { ClientAccountController } from './client-account.controller';

@Module({
  imports: [Dom26rModule],
  controllers: [OfferController, LeadController, ClientAccountController],
  providers: [
    PrismaService,
    BusinessUnitGuard,
    OfferService,
    LeadService,
    MarketingRelationshipService,
    ClientAccountService,
  ],
  exports: [
    OfferService,
    LeadService,
    MarketingRelationshipService,
    ClientAccountService,
  ],
})
export class MarketingModule {}
