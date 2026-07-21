import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { TaskService } from './task.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';

@Controller('tasks')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class TaskController {
  constructor(private taskService: TaskService) {}

  @Post()
  async create(
    @CurrentWorkspaceId() workspaceId: string,
    @Body() body: any,
  ) {
    return this.taskService.create(workspaceId, body);
  }

  @Put(':id')
  async update(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.taskService.update(workspaceId, id, body);
  }

  @Get()
  async list(@CurrentWorkspaceId() workspaceId: string) {
    return this.taskService.findAll(workspaceId);
  }

  @Get(':id')
  async get(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.taskService.findById(workspaceId, id);
  }
}
