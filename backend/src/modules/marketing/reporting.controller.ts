import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';

@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class ReportingController {
  constructor(private reporting: ReportingService) {}

  @Get('marketing/reports/internal')
  async getInternalReport(@CurrentBusinessUnitId() businessUnitId: string) {
    return this.reporting.getInternalOperatingReport(businessUnitId);
  }

  @Get('marketing/clients/:id/report')
  async getClientReport(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.reporting.getClientProgressReport(businessUnitId, id);
  }
}
