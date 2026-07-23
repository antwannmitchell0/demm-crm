import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  Prisma,
  ServiceDeliverableStatus,
  ServiceDeliverableCadence,
} from '@prisma/client';

@Injectable()
export class ServiceDeliverableService {
  constructor(private prisma: PrismaService) {}

  async findAll(businessUnitId: string, clientAccountId: string) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    return this.prisma.serviceDeliverable.findMany({
      where: { clientAccountId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    businessUnitId: string,
    actorId: string,
    clientAccountId: string,
    deliverableId: string,
    dto: {
      status?: ServiceDeliverableStatus;
      evidence?: string;
      blockerReason?: string;
      clientApprovedAt?: string;
      dueDate?: string;
    },
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    const deliverable = await this.prisma.serviceDeliverable.findFirst({
      where: { id: deliverableId, clientAccountId },
    });
    if (!deliverable) {
      throw new NotFoundException('Deliverable not found for this client');
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.ServiceDeliverableUpdateInput = {
        evidence: dto.evidence,
        blockerReason: dto.blockerReason,
        clientApprovedAt: dto.clientApprovedAt
          ? new Date(dto.clientApprovedAt)
          : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      };
      if (dto.status && dto.status !== deliverable.status) {
        data.status = dto.status;
        await tx.serviceDeliverableHistory.create({
          data: {
            deliverableId,
            oldStatus: deliverable.status,
            newStatus: dto.status,
            actorId,
          },
        });
      }
      return tx.serviceDeliverable.update({
        where: { id: deliverableId },
        data,
      });
    });
  }

  async createOutsideScope(
    businessUnitId: string,
    clientAccountId: string,
    dto: {
      name: string;
      description?: string;
      cadence: ServiceDeliverableCadence;
      cadenceDetail?: string;
    },
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: { offerSnapshot: true },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }
    return this.prisma.serviceDeliverable.create({
      data: {
        clientAccountId,
        offerSnapshotId: clientAccount.offerSnapshotId,
        sourceCapability: '',
        name: dto.name,
        description: dto.description,
        cadence: dto.cadence,
        cadenceDetail: dto.cadenceDetail,
        outsideScope: true,
      },
    });
  }
}
