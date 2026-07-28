import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Role, InvitationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { canGrant, canManage, canRemove } from './role-hierarchy';
import * as crypto from 'crypto';

/** How long an unaccepted invitation stays usable. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Serializes every operation that can change how many owners a workspace has.
   *
   * WHY A LOCK AND NOT JUST A COUNT. The last-owner rule is a check-then-act:
   * count the owners, then remove or demote one. Under READ COMMITTED two
   * concurrent transactions each removing a DIFFERENT owner both see the other's
   * row still present, both count two, both commit -- and the workspace is left
   * with zero owners and no way to administer it. This is the same shape as the
   * refresh-token amplification fixed in Phase 0C-R, and it needs the same
   * answer: let the database arbitrate.
   *
   * `FOR UPDATE` on the Workspace row is the serialization point. Any two
   * callers touching owner counts for the same workspace queue behind it;
   * callers working on different workspaces never contend.
   */
  private async withWorkspaceLock<T>(
    workspaceId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // No ::uuid cast. Workspace.id is `String @id @default(uuid())`, which
      // Prisma maps to TEXT -- the values look like UUIDs but the column is not
      // of that type, and casting the parameter makes the comparison
      // text = uuid, which Postgres rejects.
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
      return fn(tx);
    });
  }

  /** Refuses if removing/demoting this membership would leave zero owners. */
  private async assertNotLastOwner(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    membershipRole: Role,
  ) {
    if (membershipRole !== Role.ORG_OWNER) return;
    const owners = await tx.membership.count({
      where: { workspaceId, role: Role.ORG_OWNER },
    });
    if (owners <= 1) {
      throw new ConflictException(
        'This is the only owner of the workspace. Appoint another owner before removing or changing this one.',
      );
    }
  }

  async listMembers(workspaceId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      // Explicitly projected, never spread from the Prisma row. `user` carries
      // passwordHash, and `...m.user` would publish it to every administrator.
      members: memberships.map((m) => ({
        userId: m.userId,
        membershipId: m.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
      })),
    };
  }

  async listInvitations(workspaceId: string) {
    const invitations = await this.prisma.invitation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: true },
    });

    return {
      // tokenHash is deliberately absent. Publishing it would let anyone who
      // can read this list mount an offline search for the raw token, which is
      // the whole reason the token is hashed at rest.
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
        invitedByEmail: i.invitedBy?.email ?? null,
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
      })),
    };
  }

  async invite(
    workspaceId: string,
    inviterUserId: string,
    inviterRole: Role,
    email: string,
    role: Role,
  ) {
    if (!canGrant(inviterRole, role)) {
      throw new ForbiddenException(
        'You cannot invite someone at a role higher than your own.',
      );
    }

    // Read from the workspace rather than from the request. `request.user`
    // carries no organizationId, and taking one from the caller would let a
    // body or header decide which organization a membership lands in.
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }
    const organizationId = workspace.organizationId;

    const normalizedEmail = email.trim().toLowerCase();

    const existingMember = await this.prisma.membership.findFirst({
      where: { workspaceId, user: { email: normalizedEmail } },
    });
    if (existingMember) {
      throw new BadRequestException(
        'That person is already a member of this workspace.',
      );
    }

    const rawToken = crypto.randomBytes(32).toString('hex');

    const invitation = await this.prisma.$transaction(async (tx) => {
      // Supersede any invitation still outstanding for this address. Leaving
      // both live would mean two working links granting possibly different
      // roles, and revoking one would not obviously kill the other.
      await tx.invitation.updateMany({
        where: {
          workspaceId,
          email: normalizedEmail,
          status: InvitationStatus.PENDING,
        },
        data: { status: InvitationStatus.REVOKED },
      });

      return tx.invitation.create({
        data: {
          email: normalizedEmail,
          role,
          workspaceId,
          organizationId,
          tokenHash: this.hashToken(rawToken),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          invitedById: inviterUserId,
        },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        actorType: 'USER',
        actorId: inviterUserId,
        action: 'team.invitation.created',
        // The token is NOT logged. An audit entry that contains the credential
        // it is auditing defeats hashing it at rest.
        payload: { email: normalizedEmail, role, invitationId: invitation.id },
        workspaceId,
        userId: inviterUserId,
      },
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      // Returned exactly once. It is not stored in plaintext anywhere and
      // cannot be retrieved again -- a lost invitation must be re-issued.
      token: rawToken,
    };
  }

  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
    actorId: string,
  ) {
    const claimed = await this.prisma.invitation.updateMany({
      where: {
        id: invitationId,
        workspaceId,
        status: InvitationStatus.PENDING,
      },
      data: { status: InvitationStatus.REVOKED },
    });

    if (claimed.count !== 1) {
      // Scoped by workspaceId as well as id, so an administrator of one
      // workspace cannot revoke another workspace's invitation -- and cannot
      // learn that it exists.
      throw new NotFoundException('No pending invitation with that id.');
    }

    await this.prisma.auditLog.create({
      data: {
        actorType: 'USER',
        actorId,
        action: 'team.invitation.revoked',
        payload: { invitationId },
        workspaceId,
        userId: actorId,
      },
    });

    return { id: invitationId, status: InvitationStatus.REVOKED };
  }

  /**
   * Consumes an invitation for the AUTHENTICATED caller.
   *
   * The caller's identity comes from the verified JWT, and their email must
   * match the address the invitation was issued to. Possession of the token is
   * therefore necessary but NOT sufficient: a forwarded link cannot be used by
   * whoever received it, only by the person it names.
   */
  async acceptInvitation(userId: string, rawToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Invitation not found.');

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    // Same message for "no such token" and "wrong recipient": distinguishing
    // them would confirm to a holder of a stray token that it is real.
    if (!invitation) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invitation.email !== user.email.trim().toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was issued to a different email address.',
      );
    }

    if (invitation.expiresAt < new Date()) {
      // Recorded, not just rejected: an administrator looking at the list must
      // see why it stopped working.
      await this.prisma.invitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException('This invitation has expired.');
    }

    // IDEMPOTENT RETRY. The same account re-opening a link it already consumed
    // is not an error -- a user refreshing the acceptance page, or a mail
    // client prefetching the URL, must not be told something went wrong.
    // Checked BEFORE the PENDING guard below, which would otherwise reject it.
    if (
      invitation.status === InvitationStatus.ACCEPTED &&
      invitation.acceptedById === userId
    ) {
      const already = await this.prisma.membership.findFirst({
        where: { userId, workspaceId: invitation.workspaceId },
      });
      return {
        outcome: 'ALREADY_ACCEPTED' as const,
        workspaceId: invitation.workspaceId,
        // The membership's CURRENT role, never the invitation's -- an old link
        // must not describe a role the person no longer holds.
        role: already?.role ?? invitation.role,
      };
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('This invitation is no longer valid.');
    }

    return this.prisma.$transaction(async (tx) => {
      // The same conditional claim used for refresh-token rotation: exactly one
      // caller can move the row out of PENDING, so two simultaneous accepts of
      // one link cannot both create a membership.
      const claim = await tx.invitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedById: userId,
          acceptedAt: new Date(),
        },
      });
      if (claim.count !== 1) {
        throw new BadRequestException('This invitation is no longer valid.');
      }

      // CONFLICT-SAFE INSERT, and why a read-then-create will not do.
      //
      // A read-then-create closed only the case where the person was ALREADY a
      // member when acceptance began. It did nothing for two DIFFERENT pending
      // invitations addressed to the same person for the same workspace:
      // each accept claims its OWN row, so both claims succeed, both then read
      // "no membership", and both insert. Measured: statuses 201 and 500.
      //
      // Worse, the previous shape threw INSIDE this transaction, which rolled
      // the claim back with it -- the invitation returned to PENDING and every
      // retry failed identically. A permanently stuck link.
      //
      // ON CONFLICT DO NOTHING makes the database arbitrate. The row count
      // tells us which happened, so no exception is needed and the claim above
      // always stands: the invitation reaches a terminal state either way.
      //
      // DO NOTHING, never DO UPDATE: an existing membership's role must not be
      // rewritten by whatever role an old invitation happens to name.
      const inserted = await tx.$executeRaw`
        INSERT INTO "Membership"
          (id, "userId", "organizationId", "workspaceId", role, permissions, "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid()::text,
          ${userId},
          ${invitation.organizationId},
          ${invitation.workspaceId},
          ${invitation.role}::"Role",
          '{}',
          now(),
          now()
        )
        ON CONFLICT DO NOTHING
      `;

      const outcome = inserted === 1 ? 'JOINED' : 'ALREADY_MEMBER';

      // Read back rather than assume: on ALREADY_MEMBER the role that matters
      // is the one they actually hold, not the one this invitation named.
      const membership = await tx.membership.findFirst({
        where: { userId, workspaceId: invitation.workspaceId },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'USER',
          actorId: userId,
          action: 'team.invitation.accepted',
          payload: {
            invitationId: invitation.id,
            invitedRole: invitation.role,
            outcome,
            effectiveRole: membership?.role ?? null,
          },
          workspaceId: invitation.workspaceId,
          userId,
        },
      });

      return {
        outcome: outcome,
        workspaceId: invitation.workspaceId,
        role: membership?.role ?? invitation.role,
      };
    });
  }

  async changeRole(
    workspaceId: string,
    actorUserId: string,
    actorRole: Role,
    targetUserId: string,
    newRole: Role,
  ) {
    if (!canGrant(actorRole, newRole)) {
      throw new ForbiddenException(
        'You cannot assign a role higher than your own.',
      );
    }

    return this.withWorkspaceLock(workspaceId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { workspaceId, userId: targetUserId },
      });
      if (!membership) {
        throw new NotFoundException(
          'That person is not a member of this workspace.',
        );
      }

      // SECOND, INDEPENDENT QUESTION. canGrant above only asked whether the
      // PROPOSED role may be handed out. It says nothing about whether this
      // actor may touch this particular person -- and demoting is mechanically
      // "granting a lower role", so canGrant alone waved every downward change
      // through. A WORKSPACE_ADMIN rewriting an ORG_OWNER to USER returned 200.
      //
      // Evaluated inside the transaction, after the workspace row is locked, so
      // the decision is made against the role the target holds NOW rather than
      // one read before another administrator changed it.
      if (!canManage(actorRole, membership.role)) {
        throw new ForbiddenException(
          'You cannot change the role of someone whose authority is greater than your own.',
        );
      }

      if (membership.role !== newRole) {
        // Demoting the final owner orphans the workspace exactly as removing
        // them would, so it is refused by the same rule.
        await this.assertNotLastOwner(tx, workspaceId, membership.role);
      }

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { role: newRole },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'USER',
          actorId: actorUserId,
          action: 'team.member.role_changed',
          payload: {
            targetUserId,
            from: membership.role,
            to: newRole,
          },
          workspaceId,
          userId: actorUserId,
        },
      });

      return { userId: targetUserId, role: updated.role };
    });
  }

  async removeMember(
    workspaceId: string,
    actorUserId: string,
    // `actorRole` was ABSENT from this signature, which is precisely why
    // removal had no rank check: the information needed to make the decision
    // never reached the method. Any administrator could delete an ORG_OWNER as
    // long as a second owner existed to satisfy the last-owner rule. Measured
    // before the fix: HTTP 200.
    actorRole: Role,
    targetUserId: string,
  ) {
    return this.withWorkspaceLock(workspaceId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { workspaceId, userId: targetUserId },
      });
      if (!membership) {
        throw new NotFoundException(
          'That person is not a member of this workspace.',
        );
      }

      // Distinct from canManage: an AGENT membership may be REVOKED (a
      // compromised machine identity must be removable) even though its role
      // may not be edited. SUPERADMIN is refused in both directions.
      if (!canRemove(actorRole, membership.role)) {
        throw new ForbiddenException(
          'You cannot remove someone whose authority is greater than your own.',
        );
      }

      await this.assertNotLastOwner(tx, workspaceId, membership.role);

      await tx.membership.delete({ where: { id: membership.id } });

      // Access must stop NOW, not when the access token happens to expire.
      // Scoped to this workspace: revoking every token would sign the person
      // out of unrelated workspaces they are still legitimately a member of.
      await tx.refreshToken.updateMany({
        where: { userId: targetUserId, workspaceId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'USER',
          actorId: actorUserId,
          action: 'team.member.removed',
          payload: { targetUserId, role: membership.role },
          workspaceId,
          userId: actorUserId,
        },
      });

      return { userId: targetUserId, removed: true };
    });
  }
}
