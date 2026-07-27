import { Role } from '@prisma/client';

/**
 * Relative authority of each role, used to stop privilege escalation.
 *
 * The numbers are ordinal only -- the gaps carry no meaning, they exist so a
 * role can be inserted later without renumbering. What matters is the ORDER,
 * and that order is the same one the guards already enforce elsewhere:
 * ORG_OWNER outranks ORG_ADMIN outranks WORKSPACE_ADMIN outranks USER.
 *
 * AGENT is ranked BELOW user deliberately. It is a machine identity used by the
 * agent execution path, not a seat a person occupies, and it is not grantable
 * (see GRANTABLE_ROLES). Ranking it high would let an invitation mint an
 * identity the approval system treats specially.
 */
const ROLE_RANK: Record<Role, number> = {
  [Role.SUPERADMIN]: 100,
  [Role.ORG_OWNER]: 80,
  [Role.ORG_ADMIN]: 60,
  [Role.WORKSPACE_ADMIN]: 40,
  [Role.USER]: 20,
  [Role.AGENT]: 10,
};

/**
 * The roles a human may be given through an invitation or a role change.
 *
 * SUPERADMIN is excluded because it is a platform-wide role that crosses
 * organization boundaries -- granting it from inside one workspace would let a
 * workspace administrator escape their own tenant. AGENT is excluded because it
 * is not a person. Neither can be granted by any caller at any rank, which is
 * why this is a separate list rather than a rank threshold: a rank check alone
 * would let a SUPERADMIN mint another SUPERADMIN through a workspace endpoint.
 */
export const GRANTABLE_ROLES: readonly Role[] = [
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
  Role.WORKSPACE_ADMIN,
  Role.USER,
];

export function rankOf(role: Role): number {
  return ROLE_RANK[role] ?? 0;
}

/**
 * True when `actor` may grant `target`.
 *
 * The rule is "at most your own level", not "strictly below your own level": an
 * owner must be able to appoint a second owner, otherwise the last-owner
 * protection becomes a trap -- nobody could ever be added who is allowed to
 * replace the only person holding the workspace.
 */
export function canGrant(actor: Role, target: Role): boolean {
  if (!GRANTABLE_ROLES.includes(target)) return false;
  return rankOf(target) <= rankOf(actor);
}
