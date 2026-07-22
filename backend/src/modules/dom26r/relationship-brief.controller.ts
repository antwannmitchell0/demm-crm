import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RelationshipBriefService } from './relationship-brief.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dom26r/relationship-briefs')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class RelationshipBriefController {
  constructor(private briefService: RelationshipBriefService) {}

  @Post()
  async create(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Body() body: any,
  ) {
    return this.briefService.generate(
      organizationId,
      businessUnitId,
      user.id,
      correlationId,
      body,
    );
  }

  @Get()
  async list(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Query('profileId') profileId?: string,
  ) {
    return this.briefService.findAll(businessUnitId, profileId);
  }

  @Get(':id')
  async get(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @Query('view')
    view?: 'INTERNAL_AGENT' | 'INTERNAL_HUMAN' | 'CUSTOMER_VISIBLE',
  ) {
    return this.briefService.getFormatted(
      businessUnitId,
      id,
      view || 'INTERNAL_AGENT',
    );
  }
}
