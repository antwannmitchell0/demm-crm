import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { resolveAuthorizedWorkspace } from './workspace-access.util';

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
 * guard (AuthController, AppController, health/ready/version endpoints) --
 * that is the existing, intentional opt-in pattern in this codebase.
 * WorkspaceController.get(:id) uses the same resolveAuthorizedWorkspace()
 * check directly (it's a path-param route, not header/token-driven, so it
 * can't apply this guard as-is) rather than a second hand-written copy of
 * this logic.
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

    const { workspace, membership } = await resolveAuthorizedWorkspace(
      this.prisma,
      user,
      requestedWorkspaceId,
    );

    // Enforce active workspace context on request
    request.workspaceId = workspace.id;
    // Map membership role to request user for roles authorization
    request.user.role = membership.role;
    request.user.permissions = membership.permissions;

    return true;
  }
}
