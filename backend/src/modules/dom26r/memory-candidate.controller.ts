import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MemoryCandidateService } from './memory-candidate.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CandidateState } from '@prisma/client';

@Controller('dom26r/memory-candidates')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class MemoryCandidateController {
  constructor(private candidateService: MemoryCandidateService) {}

  @Post()
  async create(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Body() body: any,
  ) {
    return this.candidateService.create(
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
    @Query('status') status?: CandidateState,
  ) {
    return this.candidateService.findAll(businessUnitId, status);
  }

  @Get(':id')
  async get(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.candidateService.findByIdScoped(businessUnitId, id);
  }

  @Post(':id/approve')
  async approve(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
  ) {
    return this.candidateService.approve(
      businessUnitId,
      id,
      user.id,
      correlationId,
    );
  }

  @Post(':id/reject')
  async reject(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Body() body: { reason: string },
  ) {
    return this.candidateService.reject(
      businessUnitId,
      id,
      user.id,
      body.reason,
      correlationId,
    );
  }
}
