import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TaskStatus } from '@prisma/client';

@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}

  private async validateRelations(
    workspaceId: string,
    contactId?: string,
    opportunityId?: string,
  ) {
    if (contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: contactId, workspaceId },
      });
      if (!contact) {
        throw new ForbiddenException(
          'Relation violation: Contact does not belong to this workspace',
        );
      }
    }

    if (opportunityId) {
      const opp = await this.prisma.opportunity.findFirst({
        where: { id: opportunityId, workspaceId },
      });
      if (!opp) {
        throw new ForbiddenException(
          'Relation violation: Opportunity does not belong to this workspace',
        );
      }
    }
  }

  async create(
    workspaceId: string,
    data: {
      title: string;
      description?: string;
      dueDate?: Date;
      contactId?: string;
      opportunityId?: string;
    },
  ) {
    await this.validateRelations(
      workspaceId,
      data.contactId,
      data.opportunityId,
    );

    return this.prisma.task.create({
      data: {
        ...data,
        workspaceId,
        status: TaskStatus.PENDING,
      },
    });
  }

  async update(
    workspaceId: string,
    id: string,
    data: {
      title?: string;
      description?: string;
      status?: TaskStatus;
      dueDate?: Date;
    },
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id, workspaceId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return this.prisma.task.update({
      where: { id },
      data,
    });
  }

  async findById(workspaceId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, workspaceId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  async findAll(workspaceId: string) {
    return this.prisma.task.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
