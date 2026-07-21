import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async register(data: {
    email: string;
    passwordPlain: string;
    firstName: string;
    lastName: string;
    workspaceName: string;
    subdomain: string;
  }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(data.passwordPlain, saltRounds);

    const organization = await this.prisma.organization.create({
      data: {
        name: `${data.firstName}'s Organization`,
      },
    });

    const workspace = await this.prisma.workspace.create({
      data: {
        name: data.workspaceName,
        subdomain: data.subdomain,
        organizationId: organization.id,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
      },
    });

    await this.prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        workspaceId: workspace.id,
        role: Role.ORG_OWNER,
        permissions: ['*'],
      },
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      workspaceId: workspace.id,
      organizationId: organization.id,
    };
  }

  // 1. Initial login: returns user info + accessible workspaces
  async login(data: { email: string; passwordPlain: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: {
        memberships: {
          include: { workspace: true, organization: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(data.passwordPlain, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const availableWorkspaces = user.memberships.map((m) => ({
      workspaceId: m.workspaceId,
      workspaceName: m.workspace?.name || 'Organization Level',
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      role: m.role,
    }));

    return {
      message: 'Login successful. Please select a workspace context.',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      workspaces: availableWorkspaces,
    };
  }

  // 2. Select workspace & generate Access (15m) + Refresh (7d) tokens
  async selectWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, workspaceId },
      include: { user: true },
    });

    if (!membership) {
      throw new ForbiddenException('Access Denied: User is not a member of this workspace');
    }

    const payload = {
      sub: membership.userId,
      email: membership.user.email,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const hashedToken = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        hashedToken,
        userId,
        workspaceId,
        expiresAt,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: rawRefreshToken,
      token_type: 'Bearer',
      expires_in: 900, // 15 minutes
      user: {
        id: membership.userId,
        email: membership.user.email,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        role: membership.role,
        workspaceId: membership.workspaceId,
      },
    };
  }

  // 3. Rotate Refresh Token
  async refreshToken(rawRefreshToken: string) {
    const hashedToken = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { hashedToken },
    });

    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old refresh token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    if (!stored.workspaceId) {
      throw new UnauthorizedException('Missing workspace context on refresh token');
    }

    return this.selectWorkspace(stored.userId, stored.workspaceId);
  }

  // 4. Logout single session
  async logout(rawRefreshToken: string) {
    const hashedToken = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { hashedToken },
      data: { revoked: true },
    });
    return { status: 'SUCCESS', message: 'Logged out successfully.' };
  }

  // 5. Logout all devices
  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
    return { status: 'SUCCESS', message: 'Logged out of all sessions.' };
  }
}
