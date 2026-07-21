import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async create(
    workspaceId: string,
    data: { name: string; domain?: string; industry?: string },
  ) {
    return this.prisma.company.create({
      data: {
        ...data,
        workspaceId,
      },
    });
  }

  async update(
    workspaceId: string,
    id: string,
    data: { name?: string; domain?: string; industry?: string },
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id, workspaceId },
    });
    if (!company) {
      throw new NotFoundException('Company not found in workspace');
    }

    return this.prisma.company.update({
      where: { id },
      data,
    });
  }

  async findById(workspaceId: string, id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, workspaceId },
      include: { contacts: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async findAll(workspaceId: string) {
    return this.prisma.company.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
