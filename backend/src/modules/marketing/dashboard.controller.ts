import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';

@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('marketing/dashboard')
  async getDashboard(@CurrentBusinessUnitId() businessUnitId: string) {
    return this.dashboard.getDashboard(businessUnitId);
  }
}
