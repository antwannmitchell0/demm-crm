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

/**
 * Roles that may never be the TARGET of workspace team management, whatever the
 * actor's rank.
 *
 * SUPERADMIN is platform-wide and crosses organization boundaries. An ORG_OWNER
 * is the highest authority *inside* a workspace, which is not authority over
 * the platform -- letting one edit a SUPERADMIN membership would let a single
 * tenant strip or reshape platform administration.
 */
const UNMANAGEABLE_TARGET_ROLES: readonly Role[] = [Role.SUPERADMIN];

export function rankOf(role: Role): number {
  return ROLE_RANK[role] ?? 0;
}

/**
 * THREE SEPARATE QUESTIONS, AND WHY THEY CANNOT BE COLLAPSED INTO ONE.
 *
 * The original implementation asked only `canGrant`, and that single check was
 * a privilege-escalation hole in the DOWNWARD direction. Demoting somebody is,
 * mechanically, "granting a lower role" -- so `canGrant(WORKSPACE_ADMIN, USER)`
 * returned true (20 <= 40) and a workspace admin could rewrite an ORG_OWNER to
 * USER. The role being GRANTED was examined; the role being DESTROYED was not.
 * Measured against a real server before the fix: HTTP 200, and the owner's
 * membership came back as USER.
 *
 * Removal was worse: it asked nothing at all beyond the last-owner rule, so any
 * administrator could delete an owner outright as long as a second one existed.
 *
 *   canGrant(actor, proposedRole)       -- may I hand out this role?
 *   canManage(actor, targetCurrentRole) -- may I change this person at all?
 *   canRemove(actor, targetCurrentRole) -- may I delete this membership?
 *
 * A role change requires canManage AND canGrant. Passing either says nothing
 * about the other.
 */

/**
 * True when `actor` may grant `target`.
 *
 * "At most your own level", not "strictly below": an owner must be able to
 * appoint a second owner, or the last-owner protection becomes a trap in which
 * the only person allowed to replace the final owner is that owner.
 */
export function canGrant(actor: Role, target: Role): boolean {
  if (!GRANTABLE_ROLES.includes(target)) return false;
  return rankOf(target) <= rankOf(actor);
}

/**
 * True when `actor` may CHANGE the role of somebody currently holding
 * `targetCurrent`.
 *
 * AGENT is excluded as a target here but NOT in `canRemove` below. An AGENT
 * membership is a machine identity that the approval path treats specially;
 * turning one into a human seat -- or a human into one -- through a team screen
 * is not a meaningful operation and would silently change what the agent
 * executor is permitted to do. Deleting one IS meaningful; see canRemove.
 */
export function canManage(actor: Role, targetCurrent: Role): boolean {
  if (UNMANAGEABLE_TARGET_ROLES.includes(targetCurrent)) return false;
  if (targetCurrent === Role.AGENT) return false;
  return rankOf(targetCurrent) <= rankOf(actor);
}

/**
 * True when `actor` may REMOVE somebody currently holding `targetCurrent`.
 *
 * Deliberately NOT `return canManage(...)`. Revoking a compromised or obsolete
 * AGENT identity is exactly what an administrator must be able to do, and it is
 * the one case where removal is permitted on a target whose role may not be
 * edited. SUPERADMIN stays untouchable in both directions.
 *
 * The last-owner rule is a separate, transactional check: it depends on how
 * many owners exist at this instant rather than on who is asking, so it cannot
 * live in a pure function.
 */
export function canRemove(actor: Role, targetCurrent: Role): boolean {
  if (UNMANAGEABLE_TARGET_ROLES.includes(targetCurrent)) return false;
  return rankOf(targetCurrent) <= rankOf(actor);
}
