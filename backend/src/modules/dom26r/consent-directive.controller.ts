import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ConsentDirectiveService } from './consent-directive.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dom26r/consent-directives')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class ConsentDirectiveController {
  constructor(private consentService: ConsentDirectiveService) {}

  @Post()
  async create(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Body() body: any,
  ) {
    return this.consentService.create(
      organizationId,
      businessUnitId,
      user.id,
      correlationId,
      body,
    );
  }

  @Get()
  async list(@CurrentBusinessUnitId() businessUnitId: string) {
    return this.consentService.findAll(businessUnitId);
  }

  @Post(':id/withdraw')
  async withdraw(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
  ) {
    return this.consentService.withdraw(
      organizationId,
      businessUnitId,
      id,
      user.id,
      correlationId,
    );
  }
}
