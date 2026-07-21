import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class PipelineService {
  constructor(private prisma: PrismaService) {}

  async create(workspaceId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const pipeline = await tx.pipeline.create({
        data: { name, workspaceId },
      });

      // Default stages for custom pipeline
      const defaultStages = [
        { name: 'Lead', order: 1 },
        { name: 'Qualified', order: 2 },
        { name: 'Negotiation', order: 3 },
        { name: 'Won', order: 4 },
        { name: 'Lost', order: 5 },
      ];

      await Promise.all(
        defaultStages.map((stage) =>
          tx.stage.create({
            data: {
              name: stage.name,
              order: stage.order,
              pipelineId: pipeline.id,
            },
          }),
        ),
      );

      return tx.pipeline.findUnique({
        where: { id: pipeline.id },
        include: { stages: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async findById(workspaceId: string, id: string) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, workspaceId },
      include: {
        stages: { orderBy: { order: 'asc' } },
        opportunities: { include: { stage: true, contact: true } },
      },
    });
    if (!pipeline) {
      throw new NotFoundException('Pipeline not found');
    }
    return pipeline;
  }

  async findAll(workspaceId: string) {
    return this.prisma.pipeline.findMany({
      where: { workspaceId },
      include: { stages: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addStage(
    workspaceId: string,
    pipelineId: string,
    name: string,
    order: number,
  ) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, workspaceId },
    });
    if (!pipeline) {
      throw new NotFoundException('Pipeline not found');
    }

    return this.prisma.stage.create({
      data: {
        name,
        order,
        pipelineId,
      },
    });
  }
}
