import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('workspaces')
export class WorkspaceController {
  constructor(private workspaceService: WorkspaceService) {}

  @Post()
  async create(
    @Body('name') name: string,
    @Body('subdomain') subdomain: string,
    @Body('organizationId') organizationId: string,
  ) {
    return this.workspaceService.create(name, subdomain, organizationId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPERADMIN)
  async list() {
    return this.workspaceService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.workspaceService.findById(id);
  }
}
