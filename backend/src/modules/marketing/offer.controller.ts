import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { OfferService } from './offer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import {
  CreateOfferDto,
  UpdateOfferDto,
  SetOfferLifecycleDto,
} from './dto/offer.dto';

@Controller('marketing/offers')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class OfferController {
  constructor(private offerService: OfferService) {}

  @Get()
  async list(@CurrentBusinessUnitId() businessUnitId: string) {
    return this.offerService.findAll(businessUnitId);
  }

  @Get(':id')
  async get(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.offerService.findByIdScoped(businessUnitId, id);
  }

  @Post()
  async create(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Body() dto: CreateOfferDto,
  ) {
    return this.offerService.create(businessUnitId, dto);
  }

  @Put(':id')
  async update(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offerService.update(businessUnitId, id, dto);
  }

  @Post(':id/lifecycle')
  async setLifecycle(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @Body() dto: SetOfferLifecycleDto,
  ) {
    return this.offerService.setLifecycle(businessUnitId, id, dto.state);
  }
}
