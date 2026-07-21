import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ContactStatus } from '@prisma/client';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  private async validateRelations(workspaceId: string, companyId?: string, ownerId?: string) {
    if (companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: companyId, workspaceId },
      });
      if (!company) {
        throw new ForbiddenException('Relation violation: Company does not belong to this workspace');
      }
    }

    if (ownerId) {
      const owner = await this.prisma.membership.findFirst({
        where: { userId: ownerId, workspaceId },
      });
      if (!owner) {
        throw new ForbiddenException('Relation violation: Owner does not belong to this workspace');
      }
    }
  }

  async create(
    workspaceId: string,
    data: {
      firstName: string;
      lastName: string;
      emails?: string[];
      phones?: string[];
      address?: any;
      tags?: string[];
      status?: ContactStatus;
      source?: string;
      leadScore?: number;
      customFields?: any;
      companyId?: string;
      ownerId?: string;
    },
  ) {
    await this.validateRelations(workspaceId, data.companyId, data.ownerId);

    return this.prisma.contact.create({
      data: {
        ...data,
        workspaceId,
        status: data.status || ContactStatus.LEAD,
        emails: data.emails || [],
        phones: data.phones || [],
        tags: data.tags || [],
      },
      include: {
        company: true,
        owner: true,
      },
    });
  }

  async update(
    workspaceId: string,
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      emails?: string[];
      phones?: string[];
      address?: any;
      tags?: string[];
      status?: ContactStatus;
      source?: string;
      leadScore?: number;
      customFields?: any;
      aiSummary?: string;
      aiRecommends?: any;
      companyId?: string;
      ownerId?: string;
    },
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, workspaceId },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found in this workspace');
    }

    await this.validateRelations(workspaceId, data.companyId, data.ownerId);

    return this.prisma.contact.update({
      where: { id },
      data,
      include: {
        company: true,
        owner: true,
      },
    });
  }

  async findById(workspaceId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, workspaceId },
      include: {
        company: true,
        owner: true,
        notes: { orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' } },
        opportunities: true,
      },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  async findAll(workspaceId: string) {
    return this.prisma.contact.findMany({
      where: { workspaceId },
      include: {
        company: true,
        owner: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async search(workspaceId: string, query: string) {
    return this.prisma.contact.findMany({
      where: {
        workspaceId,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { emails: { has: query } },
          { phones: { has: query } },
          { tags: { has: query } },
        ],
      },
      include: {
        company: true,
        owner: true,
      },
    });
  }
}
