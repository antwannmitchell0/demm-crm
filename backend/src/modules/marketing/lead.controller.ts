import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { LeadService } from './lead.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CreateLeadDto } from './dto/lead.dto';

@Controller('marketing/leads')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class LeadController {
  constructor(private leadService: LeadService) {}

  @Get()
  async list(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
  ) {
    return this.leadService.findAllLeads(workspaceId, businessUnitId);
  }

  @Post()
  async create(
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @Body() dto: CreateLeadDto,
  ) {
    return this.leadService.createLead(workspaceId, businessUnitId, dto);
  }
}
