import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Role } from '@prisma/client';

// Only these roles carry an org-level (workspaceId === null) membership row
// that legitimately spans every Workspace inside their own Organization.
// This is the one place cross-workspace access is granted without a direct
// workspace-scoped membership row -- and it never crosses Organizations.
export const ORG_WIDE_ROLES: Role[] = [
  Role.SUPERADMIN,
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
];

/**
 * Single source of truth for "does this authenticated user have a
 * legitimate reason to reach this Workspace." Used by WorkspaceGuard (the
 * header/token-driven path used by most controllers) and by
 * WorkspaceController itself (the path-param-driven `:id` route) so the
 * authorization logic never has to be kept in sync by hand across two
 * copies.
 *
 * Resolves and returns the target Workspace row (id, organizationId), or
 * throws ForbiddenException. Never returns null/undefined silently.
 */
interface MembershipLike {
  workspaceId: string | null;
  organizationId: string;
  role: Role;
  permissions?: string[];
}

export async function resolveAuthorizedWorkspace(
  prisma: PrismaService,
  user: { memberships?: MembershipLike[] },
  workspaceId: string,
): Promise<{
  workspace: { id: string; organizationId: string };
  membership: MembershipLike;
}> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, organizationId: true },
  });
  if (!workspace) {
    throw new ForbiddenException('Requested workspace does not exist');
  }

  const memberships = user.memberships || [];

  const direct = memberships.find(
    (m) =>
      m.workspaceId === workspace.id &&
      m.organizationId === workspace.organizationId,
  );
  if (direct) return { workspace, membership: direct };

  const orgWide = memberships.find(
    (m) =>
      m.workspaceId === null &&
      m.organizationId === workspace.organizationId &&
      ORG_WIDE_ROLES.includes(m.role),
  );
  if (orgWide) return { workspace, membership: orgWide };

  throw new ForbiddenException(
    'User is not authorized to access this workspace',
  );
}
