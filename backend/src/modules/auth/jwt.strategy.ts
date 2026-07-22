import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    workspaceId?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { memberships: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    // The workspace the user authenticated into (set by selectWorkspace/
    // refreshToken, and only after verifying real membership at issuance
    // time). WorkspaceGuard treats this as a fallback when no per-request
    // x-workspace-id header is sent -- it is re-validated against current
    // membership state on every request, never trusted blindly.
    return { ...user, tokenWorkspaceId: payload.workspaceId };
  }
}
