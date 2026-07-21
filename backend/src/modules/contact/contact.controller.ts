import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContactService } from './contact.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';

@Controller('contacts')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ContactController {
  constructor(private contactService: ContactService) {}

  @Post()
  async create(@CurrentWorkspaceId() workspaceId: string, @Body() body: any) {
    return this.contactService.create(workspaceId, body);
  }

  @Put(':id')
  async update(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.contactService.update(workspaceId, id, body);
  }

  @Get()
  async list(@CurrentWorkspaceId() workspaceId: string) {
    return this.contactService.findAll(workspaceId);
  }

  @Get('search')
  async search(
    @CurrentWorkspaceId() workspaceId: string,
    @Query('q') query: string,
  ) {
    return this.contactService.search(workspaceId, query || '');
  }

  @Get(':id')
  async get(
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.contactService.findById(workspaceId, id);
  }
}
