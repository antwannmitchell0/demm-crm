import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma, OpportunityStatus } from '@prisma/client';

@Injectable()
export class OpportunityService {
  constructor(private prisma: PrismaService) {}

  private async validateRelations(
    workspaceId: string,
    relations: {
      pipelineId?: string;
      stageId?: string;
      contactId?: string;
      ownerId?: string;
    },
  ) {
    if (relations.pipelineId) {
      const pipeline = await this.prisma.pipeline.findFirst({
        where: { id: relations.pipelineId, workspaceId },
      });
      if (!pipeline) {
        throw new ForbiddenException('Relation violation: Pipeline does not belong to this workspace');
      }
    }

    if (relations.stageId) {
      const stage = await this.prisma.stage.findFirst({
        where: { id: relations.stageId, pipeline: { workspaceId } },
      });
      if (!stage) {
        throw new ForbiddenException('Relation violation: Stage does not belong to this workspace');
      }
    }

    if (relations.contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: relations.contactId, workspaceId },
      });
      if (!contact) {
        throw new ForbiddenException('Relation violation: Contact does not belong to this workspace');
      }
    }

    if (relations.ownerId) {
      const owner = await this.prisma.membership.findFirst({
        where: { userId: relations.ownerId, workspaceId },
      });
      if (!owner) {
        throw new ForbiddenException('Relation violation: Owner does not belong to this workspace');
      }
    }
  }

  async create(
    workspaceId: string,
    data: {
      name: string;
      value?: number | Prisma.Decimal;
      probability?: number;
      expectedClose?: Date;
      pipelineId: string;
      stageId: string;
      contactId?: string;
      ownerId?: string;
    },
  ) {
    // Prevent relation hijacking
    await this.validateRelations(workspaceId, {
      pipelineId: data.pipelineId,
      stageId: data.stageId,
      contactId: data.contactId,
      ownerId: data.ownerId,
    });

    const numericValue = data.value !== undefined ? new Prisma.Decimal(data.value.toString()) : new Prisma.Decimal(0.00);

    return this.prisma.opportunity.create({
      data: {
        ...data,
        value: numericValue,
        workspaceId,
        status: OpportunityStatus.OPEN,
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
      value?: number | Prisma.Decimal;
      probability?: number;
      expectedClose?: Date;
      status?: OpportunityStatus;
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

    // Prevent relation hijacking
    await this.validateRelations(workspaceId, {
      stageId: data.stageId,
      contactId: data.contactId,
      ownerId: data.ownerId,
    });

    const updateData: any = { ...data };
    if (data.value !== undefined) {
      updateData.value = new Prisma.Decimal(data.value.toString());
    }

    return this.prisma.opportunity.update({
      where: { id },
      data: updateData,
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
      throw new NotFoundException('Opportunity not found in workspace');
    }

    await this.validateRelations(workspaceId, { stageId });

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
