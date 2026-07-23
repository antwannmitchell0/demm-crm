import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  UpdateChecklistItemDto,
  ActivateClientDto,
} from './dto/onboarding.dto';
import { Role } from '@prisma/client';

/**
 * The override role check is done inline here (reading dto.override to
 * decide whether to enforce it) rather than via a blanket @Roles() on the
 * whole activate() method, because non-override activation must stay
 * reachable by any authenticated BU member -- see design spec Section 3.
 */
const OVERRIDE_ALLOWED_ROLES: Role[] = [
  Role.SUPERADMIN,
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
  Role.WORKSPACE_ADMIN,
];

@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class OnboardingController {
  constructor(private onboarding: OnboardingService) {}

  @Get('marketing/clients/:id/onboarding')
  async getPlan(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.onboarding.getPlanDetail(businessUnitId, id);
  }

  @Patch('marketing/clients/:id/onboarding/items/:itemId')
  async updateItem(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.onboarding.updateItem(businessUnitId, user.id, id, itemId, dto);
  }

  @Post('marketing/clients/:id/onboarding/generate')
  async generate(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Param('id') id: string,
  ) {
    return this.onboarding.prismaTransactionGenerate(
      organizationId,
      businessUnitId,
      workspaceId,
      user.id,
      correlationId,
      id,
    );
  }

  @Post('marketing/clients/:id/onboarding/activate')
  async activate(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Param('id') id: string,
    @Body() dto: ActivateClientDto,
  ) {
    if (dto.override && !OVERRIDE_ALLOWED_ROLES.includes(user.role)) {
      throw new ForbiddenException('This role cannot override a launch gate');
    }
    return this.onboarding.activate(
      organizationId,
      businessUnitId,
      workspaceId,
      user.id,
      correlationId,
      id,
      dto.override,
    );
  }
}
