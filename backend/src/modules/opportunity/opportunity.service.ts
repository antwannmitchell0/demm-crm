import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class OpportunityService {
  constructor(private prisma: PrismaService) {}

  async create(
    workspaceId: string,
    data: {
      name: string;
      value?: number;
      probability?: number;
      expectedClose?: Date;
      pipelineId: string;
      stageId: string;
      contactId?: string;
      ownerId?: string;
    },
  ) {
    return this.prisma.opportunity.create({
      data: {
        ...data,
        workspaceId,
      },
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        owner: true,
      },
    });
  }

  async update(
    workspaceId: string,
    id: string,
    data: {
      name?: string;
      value?: number;
      probability?: number;
      expectedClose?: Date;
      status?: string;
      stageId?: string;
      contactId?: string;
      ownerId?: string;
      aiInsights?: string;
    },
  ) {
    const opp = await this.prisma.opportunity.findFirst({
      where: { id, workspaceId },
    });
    if (!opp) {
      throw new NotFoundException('Opportunity not found in workspace');
    }

    return this.prisma.opportunity.update({
      where: { id },
      data,
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        owner: true,
      },
    });
  }

  async moveStage(workspaceId: string, id: string, stageId: string) {
    const opp = await this.prisma.opportunity.findFirst({
      where: { id, workspaceId },
    });
    if (!opp) {
      throw new NotFoundException('Opportunity not found');
    }

    // Verify stage belongs to same pipeline (or at least same workspace)
    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, pipeline: { workspaceId } },
    });
    if (!stage) {
      throw new NotFoundException('Target stage not found in this workspace');
    }

    // Move stage and log activity
    const updatedOpp = await this.prisma.opportunity.update({
      where: { id },
      data: { stageId },
      include: { stage: true },
    });

    await this.prisma.activity.create({
      data: {
        type: 'SYSTEM_EVENT',
        description: `Moved deal to stage: ${updatedOpp.stage.name}`,
        opportunityId: id,
      },
    });

    return updatedOpp;
  }

  async findById(workspaceId: string, id: string) {
    const opp = await this.prisma.opportunity.findFirst({
      where: { id, workspaceId },
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        owner: true,
        notes: { orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!opp) {
      throw new NotFoundException('Opportunity not found');
    }
    return opp;
  }

  async findAll(workspaceId: string) {
    return this.prisma.opportunity.findMany({
      where: { workspaceId },
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        owner: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
