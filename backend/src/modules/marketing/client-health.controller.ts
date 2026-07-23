import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ClientHealthService } from './client-health.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OverrideHealthDto } from './dto/client-health.dto';
import { Role } from '@prisma/client';

// Same allowed-role set as the onboarding launch-gate override -- overriding
// a computed risk assessment is an equally consequential action.
const OVERRIDE_ALLOWED_ROLES: Role[] = [
  Role.SUPERADMIN,
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
  Role.WORKSPACE_ADMIN,
];

@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class ClientHealthController {
  constructor(private health: ClientHealthService) {}

  @Get('marketing/clients/:id/health')
  async getHealth(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.health.getHealth(businessUnitId, id);
  }

  @Post('marketing/clients/:id/health/recalculate')
  async recalculate(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Param('id') id: string,
  ) {
    return this.health.calculate(businessUnitId, id, user.id, correlationId);
  }

  @Post('marketing/clients/:id/health/override')
  async override(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: OverrideHealthDto,
  ) {
    if (!OVERRIDE_ALLOWED_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'This role cannot override a Client Health assessment',
      );
    }
    return this.health.override(
      businessUnitId,
      user.id,
      id,
      dto.state,
      dto.reason,
    );
  }

  @Delete('marketing/clients/:id/health/override')
  async clearOverride(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    if (!OVERRIDE_ALLOWED_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'This role cannot clear a Client Health override',
      );
    }
    return this.health.clearOverride(businessUnitId, user.id, id);
  }
}
