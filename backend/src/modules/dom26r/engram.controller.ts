import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EngramService } from './engram.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dom26r/engrams')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class EngramController {
  constructor(private engramService: EngramService) {}

  @Post()
  async create(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Body() body: any,
  ) {
    return this.engramService.create(
      organizationId,
      businessUnitId,
      workspaceId,
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
    return this.engramService.findAll(businessUnitId, profileId);
  }

  @Get(':id')
  async get(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.engramService.findByIdScoped(businessUnitId, id);
  }

  @Post(':id/correct')
  async correct(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Body()
    body: { correctedSummary: string; correctedContent?: any; reason: string },
  ) {
    return this.engramService.correct(
      businessUnitId,
      id,
      user.id,
      correlationId,
      body.correctedSummary,
      body.correctedContent,
      body.reason,
    );
  }

  @Post(':id/forget')
  async forget(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
  ) {
    return this.engramService.forget(
      businessUnitId,
      id,
      user.id,
      correlationId,
    );
  }
}
