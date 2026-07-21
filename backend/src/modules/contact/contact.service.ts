import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async create(
    workspaceId: string,
    data: {
      firstName: string;
      lastName: string;
      emails?: string[];
      phones?: string[];
      address?: any;
      tags?: string[];
      status?: string;
      source?: string;
      leadScore?: number;
      customFields?: any;
      companyId?: string;
      ownerId?: string;
    },
  ) {
    return this.prisma.contact.create({
      data: {
        ...data,
        workspaceId,
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
      status?: string;
      source?: string;
      leadScore?: number;
      customFields?: any;
      aiSummary?: string;
      aiRecommends?: any;
      companyId?: string;
      ownerId?: string;
    },
  ) {
    // Verify it exists in workspace
    const contact = await this.prisma.contact.findFirst({
      where: { id, workspaceId },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found in this workspace');
    }

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
