import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { ORG_WIDE_ROLES } from '../../common/guards/workspace-access.util';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private workspaceService: WorkspaceService) {}

  // Creating a Workspace inside an existing Organization is an
  // authenticated, in-org-admin action -- NOT public signup. Public signup
  // is AuthController.register(), which creates its own Organization +
  // Workspace + owner Membership server-side with no client-supplied ids.
  @Post()
  async create(@Request() req: any, @Body() body: CreateWorkspaceDto) {
    const memberships = req.user.memberships || [];
    const authorized = memberships.some(
      (m: any) =>
        m.workspaceId === null &&
        m.organizationId === body.organizationId &&
        ORG_WIDE_ROLES.includes(m.role),
    );
    if (!authorized) {
      throw new ForbiddenException(
        'User is not authorized to create a workspace in this organization',
      );
    }
    return this.workspaceService.create(
      body.name,
      body.subdomain,
      body.organizationId,
    );
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async list() {
    return this.workspaceService.findAll();
  }

  @Get(':id')
  async get(@Request() req: any, @Param('id') id: string) {
    return this.workspaceService.findByIdAuthorized(req.user, id);
  }
}
