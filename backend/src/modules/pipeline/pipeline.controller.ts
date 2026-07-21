import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';

@Controller('pipelines')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class PipelineController {
  constructor(private pipelineService: PipelineService) {}

  @Post()
  async create(
    @CurrentWorkspaceId() workspaceId: string,
    @Body('name') name: string,
  ) {
    return this.pipelineService.create(workspaceId, name);
  }

  @Get()
  async list(@CurrentWorkspaceId() workspaceId: string) {
    return this.pipelineService.findAll(workspaceId);
  }

  @Get(':id')
  async get(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.pipelineService.findById(workspaceId, id);
  }

  @Post(':id/stages')
  async addStage(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') pipelineId: string,
    @Body('name') name: string,
    @Body('order') order: number,
  ) {
    return this.pipelineService.addStage(workspaceId, pipelineId, name, order);
  }
}
