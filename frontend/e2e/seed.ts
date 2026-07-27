// Browser UAT -- synthetic fixtures, written with `pg` and raw SQL.
//
// WHY NOT PRISMA HERE. The generated Prisma client lives in the BACKEND's
// node_modules and is produced by a generate step. Depending on it from the
// frontend harness means either duplicating the client or reaching across
// packages, and a missing generate breaks the entire run before a single test
// is collected. `pg` needs no generation and the fixture set is small enough
// that explicit SQL is clearer than an ORM anyway.
//
// Everything here is disposable and fabricated. No customer data, no owner
// credentials, no real provider. The database name carries the `_verify`
// suffix that backend/test-db-guard.ts recognises as throwaway, so this can
// never be pointed at a real database even by accident.
import { Client } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UAT_DATABASE_URL } from './uat-db';

export { UAT_DB, UAT_DATABASE_URL, UAT_PASSWORD, PG_USER } from './uat-db';
import { UAT_PASSWORD } from './uat-db';

export interface SeedResult {
  runId: string;
  owner: { email: string; id: string };
  admin: { email: string; id: string };
  member: { email: string; id: string };
  invitee: { email: string; id: string };
  workspaceA: { id: string; name: string };
  workspaceB: { id: string; name: string };
  pendingApprovalId: string;
  revokableInvitationEmail: string;
}

const uuid = () => crypto.randomUUID();
const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

async function connect() {
  const c = new Client({ connectionString: UAT_DATABASE_URL });
  await c.connect();
  return c;
}

/**
 * Builds the fixture set every browser journey runs against.
 *
 * Deterministic in SHAPE but unique per run: emails and subdomains carry a run
 * id so repeated runs cannot collide, and teardown removes only what this run
 * created.
 */
export async function seed(): Promise<SeedResult> {
  const c = await connect();
  const runId = `${Date.now()}`;
  const passwordHash = await bcrypt.hash(UAT_PASSWORD, 10);

  try {
    const orgId = uuid();
    await c.query(
      `INSERT INTO "Organization" (id,name,"createdAt","updatedAt") VALUES ($1,$2,now(),now())`,
      [orgId, `UAT Org ${runId}`],
    );

    // Two workspaces so the switcher has somewhere real to go.
    const wsA = uuid();
    const wsB = uuid();
    const mkWorkspace = (id: string, name: string, sub: string) =>
      c.query(
        `INSERT INTO "Workspace" (id,name,subdomain,"organizationId","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,now(),now())`,
        [id, name, sub, orgId],
      );
    await mkWorkspace(wsA, 'Downtown Studio', `uat-a-${runId}`);
    await mkWorkspace(wsB, 'Airport Location', `uat-b-${runId}`);

    const mkUser = async (label: string, first: string, last: string) => {
      const id = uuid();
      const email = `uat-${label}-${runId}@example.invalid`;
      await c.query(
        `INSERT INTO "User" (id,email,"passwordHash","firstName","lastName","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,now(),now())`,
        [id, email, passwordHash, first, last],
      );
      return { id, email };
    };

    const owner = await mkUser('owner', 'Olivia', 'Owner');
    const admin = await mkUser('admin', 'Adam', 'Admin');
    const member = await mkUser('member', 'Mia', 'Member');
    // Has an account but belongs to nothing -- the invitation recipient.
    const invitee = await mkUser('invitee', 'Ivan', 'Invitee');

    const mkMembership = (userId: string, workspaceId: string, role: string) =>
      c.query(
        `INSERT INTO "Membership" (id,"userId","organizationId","workspaceId",role,permissions,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5::"Role",'{}',now(),now())`,
        [uuid(), userId, orgId, workspaceId, role],
      );

    // The owner is in BOTH workspaces, so the switcher is exercised by someone
    // who genuinely has an alternative.
    await mkMembership(owner.id, wsA, 'ORG_OWNER');
    await mkMembership(owner.id, wsB, 'ORG_OWNER');
    await mkMembership(admin.id, wsA, 'WORKSPACE_ADMIN');
    await mkMembership(member.id, wsA, 'USER');

    // A pending high-risk approval requested by the ADMIN, so the owner can
    // resolve it without self-approving.
    const approvalId = uuid();
    await c.query(
      `INSERT INTO "AgentApproval"
         (id,"toolName",arguments,status,"workspaceId","requestedById","requesterRole","expiresAt","createdAt","updatedAt")
       VALUES ($1,$2,$3::jsonb,'PENDING'::"ApprovalStatus",$4,$5,'WORKSPACE_ADMIN'::"Role",now() + interval '7 days',now(),now())`,
      [
        approvalId,
        'createOpportunity',
        JSON.stringify({
          name: 'UAT High Value Deal',
          value: 9000,
          pipelineId: '00000000-0000-4000-8000-000000000001',
          stageId: '00000000-0000-4000-8000-000000000002',
        }),
        wsA,
        admin.id,
      ],
    );

    // A second approval, already rejected, so "resolved states stay distinct"
    // has something real to look at.
    await c.query(
      `INSERT INTO "AgentApproval"
         (id,"toolName",arguments,status,"workspaceId","requestedById","requesterRole","resolvedById","expiresAt","createdAt","updatedAt")
       VALUES ($1,$2,$3::jsonb,'REJECTED'::"ApprovalStatus",$4,$5,'WORKSPACE_ADMIN'::"Role",$6,now() + interval '7 days',now(),now())`,
      [
        uuid(),
        'createOpportunity',
        JSON.stringify({ name: 'UAT Rejected Deal', value: 12000 }),
        wsA,
        admin.id,
        owner.id,
      ],
    );

    // A pending invitation that already exists, so "revoke a pending
    // invitation" does not depend on an earlier journey having succeeded.
    const revokableEmail = `uat-revokable-${runId}@example.invalid`;
    await c.query(
      `INSERT INTO "Invitation"
         (id,email,role,"workspaceId","organizationId","tokenHash",status,"expiresAt","createdAt","invitedById")
       VALUES ($1,$2,'USER'::"Role",$3,$4,$5,'PENDING'::"InvitationStatus",now() + interval '7 days',now(),$6)`,
      [
        uuid(),
        revokableEmail,
        wsA,
        orgId,
        sha256(crypto.randomBytes(32).toString('hex')),
        owner.id,
      ],
    );

    return {
      runId,
      owner,
      admin,
      member,
      invitee,
      workspaceA: { id: wsA, name: 'Downtown Studio' },
      workspaceB: { id: wsB, name: 'Airport Location' },
      pendingApprovalId: approvalId,
      revokableInvitationEmail: revokableEmail,
    };
  } finally {
    await c.end();
  }
}

/** Removes everything a run created. Safe to call twice. */
export async function teardown(runId: string) {
  const c = await connect();
  try {
    const org = await c.query(`SELECT id FROM "Organization" WHERE name = $1`, [
      `UAT Org ${runId}`,
    ]);
    if (org.rowCount === 0) return;
    const orgId = org.rows[0].id;

    // AgentApproval.workspaceId is a plain column with no FK cascade, so
    // deleting the Organization does not remove these rows.
    await c.query(
      `DELETE FROM "AgentApproval" WHERE "workspaceId" IN
         (SELECT id FROM "Workspace" WHERE "organizationId" = $1)`,
      [orgId],
    );
    const users = await c.query(
      `SELECT id FROM "User" WHERE email LIKE $1`,
      [`%-${runId}@example.invalid`],
    );
    const userIds = users.rows.map((r) => r.id);
    if (userIds.length) {
      await c.query(`DELETE FROM "AuditLog" WHERE "userId" = ANY($1)`, [userIds]);
      await c.query(`DELETE FROM "RefreshToken" WHERE "userId" = ANY($1)`, [userIds]);
      await c.query(`DELETE FROM "Membership" WHERE "userId" = ANY($1)`, [userIds]);
    }
    await c.query(`DELETE FROM "Invitation" WHERE "organizationId" = $1`, [orgId]);
    if (userIds.length) {
      await c.query(`DELETE FROM "User" WHERE id = ANY($1)`, [userIds]);
    }
    await c.query(`DELETE FROM "Organization" WHERE id = $1`, [orgId]);
  } finally {
    await c.end();
  }
}
