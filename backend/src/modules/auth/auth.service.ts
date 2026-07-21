import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(data: {
    email: string;
    passwordPlain: string;
    firstName: string;
    lastName: string;
    workspaceName: string;
    subdomain: string;
  }) {
    // Check if user exists
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // Check if subdomain exists
    const existingWS = await this.prisma.workspace.findUnique({
      where: { subdomain: data.subdomain },
    });
    if (existingWS) {
      throw new ConflictException('Subdomain already in use');
    }

    const passwordHash = await bcrypt.hash(data.passwordPlain, 10);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Organization
      const org = await tx.organization.create({
        data: { name: `${data.workspaceName} Org` },
      });

      // 2. Create Workspace
      const workspace = await tx.workspace.create({
        data: {
          name: data.workspaceName,
          subdomain: data.subdomain,
          organizationId: org.id,
        },
      });

      // 3. Create User
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
        },
      });

      // 4. Create Membership (Owner of Org)
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          workspaceId: workspace.id,
          role: Role.ORG_OWNER,
          permissions: ['*'], // Super user scope
        },
      });

      // Seed Default Pipeline
      const pipeline = await tx.pipeline.create({
        data: {
          name: 'General Sales',
          workspaceId: workspace.id,
        },
      });

      // Seed Default Stages
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

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        workspaceId: workspace.id,
        organizationId: org.id,
      };
    });
  }

  async login(email: string, passwordPlain: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { workspace: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const primaryMembership = user.memberships[0];
    if (!primaryMembership) {
      throw new UnauthorizedException('User has no active tenant memberships');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      workspaceId: primaryMembership.workspaceId,
      organizationId: primaryMembership.organizationId,
      role: primaryMembership.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: primaryMembership.role,
        workspaceId: primaryMembership.workspaceId,
      },
    };
  }
}
