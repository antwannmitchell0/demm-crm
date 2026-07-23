import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ServiceDeliverableService } from './service-deliverable.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  UpdateDeliverableDto,
  CreateOutsideScopeDeliverableDto,
} from './dto/service-deliverable.dto';

@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class ServiceDeliverableController {
  constructor(private deliverables: ServiceDeliverableService) {}

  @Get('marketing/clients/:id/deliverables')
  async findAll(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
  ) {
    return this.deliverables.findAll(businessUnitId, id);
  }

  @Patch('marketing/clients/:id/deliverables/:deliverableId')
  async update(
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('deliverableId') deliverableId: string,
    @Body() dto: UpdateDeliverableDto,
  ) {
    return this.deliverables.update(businessUnitId, user.id, id, deliverableId, dto);
  }

  @Post('marketing/clients/:id/deliverables')
  async createOutsideScope(
    @CurrentBusinessUnitId() businessUnitId: string,
    @Param('id') id: string,
    @Body() dto: CreateOutsideScopeDeliverableDto,
  ) {
    return this.deliverables.createOutsideScope(businessUnitId, id, dto);
  }
}
