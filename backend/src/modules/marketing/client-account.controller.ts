import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { ClientAccountService } from './client-account.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentOrganizationId } from '../../common/decorators/current-organization.decorator';
import { CurrentCorrelationId } from '../../common/decorators/current-correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConvertLeadDto } from './dto/convert-lead.dto';

/**
 * One controller covering both route groups the plan calls for --
 * `marketing/leads/:contactId/convert` (the conversion action) and
 * `marketing/clients/:id` (post-conversion client detail) -- via
 * method-level paths, since Nest's `@Controller()` prefix is one string
 * per class and these two resources don't share a common prefix.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class ClientAccountController {
  constructor(private clientAccountService: ClientAccountService) {}

  @Post('marketing/leads/:contactId/convert')
  async convert(
    @CurrentOrganizationId() organizationId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentUser() user: any,
    @CurrentCorrelationId() correlationId: string,
    @Param('contactId') contactId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.clientAccountService.convert(
      organizationId,
      businessUnitId,
      workspaceId,
      user.id,
      correlationId,
      contactId,
      idempotencyKey,
      dto,
    );
  }

  @Get('marketing/clients/:id')
  async getClientDetail(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.clientAccountService.getClientDetail(businessUnitId, id);
  }
}
