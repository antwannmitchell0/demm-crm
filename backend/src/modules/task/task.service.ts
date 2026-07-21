import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}

  async create(
    workspaceId: string,
    data: { title: string; description?: string; dueDate?: Date; contactId?: string; opportunityId?: string },
  ) {
    return this.prisma.task.create({
      data: {
        ...data,
        workspaceId,
      },
    });
  }

  async update(
    workspaceId: string,
    id: string,
    data: { title?: string; description?: string; status?: string; dueDate?: Date },
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
