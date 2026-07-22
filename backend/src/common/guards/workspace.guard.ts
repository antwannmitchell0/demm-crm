import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Role } from '@prisma/client';

// Only these roles carry an org-level (workspaceId === null) membership row
// that legitimately spans every Workspace inside their own Organization.
// This is the one place cross-workspace access is granted without a direct
// workspace-scoped membership row -- and it never crosses Organizations.
const ORG_WIDE_ROLES: Role[] = [
  Role.SUPERADMIN,
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves and enforces Workspace scope for every route it guards.
 *
 * Deterministic resolution order for the target workspace id:
 *   1. `x-workspace-id` header, if present (must be a single well-formed
 *      UUID -- a missing/duplicate/malformed header is rejected outright,
 *      never silently coerced).
 *   2. Otherwise, the `workspaceId` embedded in the caller's access token
 *      (set by AuthService.selectWorkspace/refreshToken, which already
 *      verified membership at issuance time).
 *   3. Otherwise: deny. There is no "pick the first membership" fallback.
 *
 * Whichever id is resolved, it is re-validated against the CALLER'S CURRENT
 * membership state on every request -- a token claim or header value is
 * never trusted on its own. A direct workspace-scoped membership is
 * required, UNLESS the caller holds an org-level membership (workspaceId
 * null) with an org-wide role (SUPERADMIN/ORG_OWNER/ORG_ADMIN) in the SAME
 * organization that owns the target workspace.
 *
 * Routes that should not require Workspace context simply don't apply this
 * guard (see WorkspaceController.create/get, AuthController, AppController,
 * dashboard/health endpoints) -- that is the existing, intentional opt-in
 * pattern in this codebase and this guard does not change it.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Added by JwtAuthGuard

    if (!user) {
      throw new ForbiddenException('User session not found');
    }

    const rawHeader = request.headers['x-workspace-id'];
    if (Array.isArray(rawHeader)) {
      throw new BadRequestException(
        'Malformed x-workspace-id header: multiple values not allowed',
      );
    }

    const requestedWorkspaceId: string | undefined =
      rawHeader || user.tokenWorkspaceId;

    if (!requestedWorkspaceId) {
      throw new ForbiddenException(
        'Workspace context is required for this route',
      );
    }

    if (!UUID_RE.test(requestedWorkspaceId)) {
      throw new BadRequestException('Invalid workspace identifier');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: requestedWorkspaceId },
      select: { id: true, organizationId: true },
    });
    if (!workspace) {
      throw new ForbiddenException('Requested workspace does not exist');
    }

    const memberships: any[] = user.memberships || [];

    let membership = memberships.find(
      (m) =>
        m.workspaceId === workspace.id &&
        m.organizationId === workspace.organizationId,
    );

    if (!membership) {
      membership = memberships.find(
        (m) =>
          m.workspaceId === null &&
          m.organizationId === workspace.organizationId &&
          ORG_WIDE_ROLES.includes(m.role),
      );
    }

    if (!membership) {
      throw new ForbiddenException(
        'User is not a member of the requested workspace',
      );
    }

    // Enforce active workspace context on request
    request.workspaceId = workspace.id;
    // Map membership role to request user for roles authorization
    request.user.role = membership.role;
    request.user.permissions = membership.permissions;

    return true;
  }
}
