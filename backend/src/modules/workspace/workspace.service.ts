import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { resolveAuthorizedWorkspace } from '../../common/guards/workspace-access.util';

@Injectable()
export class WorkspaceService {
  constructor(private prisma: PrismaService) {}

  async create(name: string, subdomain: string, organizationId: string) {
    // Check if subdomain is unique
    const existing = await this.prisma.workspace.findUnique({
      where: { subdomain },
    });
    if (existing) {
      throw new ConflictException('Subdomain already in use');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Workspace
      const workspace = await tx.workspace.create({
        data: { name, subdomain, organizationId },
      });

      // 2. Seed Default Pipeline
      const pipeline = await tx.pipeline.create({
        data: {
          name: 'General Sales',
          workspaceId: workspace.id,
        },
      });

      // 3. Seed Default Stages
      const defaultStages = [
        { name: 'Lead In', order: 1 },
        { name: 'Contacted', order: 2 },
        { name: 'Meeting Scheduled', order: 3 },
        { name: 'Proposal Sent', order: 4 },
        { name: 'Won', order: 5 },
        { name: 'Lost', order: 6 },
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

      return workspace;
    });
  }

  async findById(id: string) {
    return this.prisma.workspace.findUnique({
      where: { id },
      include: {
        pipelines: {
          include: { stages: { orderBy: { order: 'asc' } } },
        },
      },
    });
  }

  /** Same as findById, but only after confirming the caller is actually
   * authorized to see this Workspace (direct membership, or an org-wide
   * role in the same Organization). Never an anonymous/arbitrary lookup. */
  async findByIdAuthorized(user: any, id: string) {
    await resolveAuthorizedWorkspace(this.prisma, user, id);
    return this.findById(id);
  }

  async findAll() {
    return this.prisma.workspace.findMany();
  }
}
