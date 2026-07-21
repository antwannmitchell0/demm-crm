import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { OpportunityService } from './opportunity.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';

@Controller('opportunities')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class OpportunityController {
  constructor(private opportunityService: OpportunityService) {}

  @Post()
  async create(@CurrentWorkspaceId() workspaceId: string, @Body() body: any) {
    return this.opportunityService.create(workspaceId, body);
  }

  @Put(':id')
  async update(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.opportunityService.update(workspaceId, id, body);
  }

  @Put(':id/move')
  async moveStage(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body('stageId') stageId: string,
  ) {
    return this.opportunityService.moveStage(workspaceId, id, stageId);
  }

  @Get()
  async list(@CurrentWorkspaceId() workspaceId: string) {
    return this.opportunityService.findAll(workspaceId);
  }

  @Get(':id')
  async get(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.opportunityService.findById(workspaceId, id);
  }
}
