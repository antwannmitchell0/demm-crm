import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { CompanyService } from './company.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';

@Controller('companies')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class CompanyController {
  constructor(private companyService: CompanyService) {}

  @Post()
  async create(
    @CurrentWorkspaceId() workspaceId: string,
    @Body() body: any,
  ) {
    return this.companyService.create(workspaceId, body);
  }

  @Put(':id')
  async update(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.companyService.update(workspaceId, id, body);
  }

  @Get()
  async list(@CurrentWorkspaceId() workspaceId: string) {
    return this.companyService.findAll(workspaceId);
  }

  @Get(':id')
  async get(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.companyService.findById(workspaceId, id);
  }
}
