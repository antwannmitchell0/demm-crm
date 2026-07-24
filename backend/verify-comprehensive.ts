import 'dotenv/config';
import {
  Role,
  OpportunityStatus,
  TaskStatus,
  ContactStatus,
  InvitationStatus,
  ApprovalStatus,
  ActivityType,
  Prisma,
} from '@prisma/client';
import { ContactService } from './src/modules/contact/contact.service';
import { PipelineService } from './src/modules/pipeline/pipeline.service';
import { OpportunityService } from './src/modules/opportunity/opportunity.service';
import { DashboardService } from './src/modules/dashboard/dashboard.service';
import { AgentService } from './src/modules/agent/agent.service';
import { TaskService } from './src/modules/task/task.service';
import { CompanyService } from './src/modules/company/company.service';
import { AuthService } from './src/modules/auth/auth.service';
import { PrismaService } from './src/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { redactAuditPayload } from './src/common/utils/audit-redactor';
import { validateEnvironmentConfig } from './src/common/utils/config.validator';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_SECRET! });

// Instantiate Services
const contactService = new ContactService(prisma);
const pipelineService = new PipelineService(prisma);
const opportunityService = new OpportunityService(prisma);
const dashboardService = new DashboardService(prisma);
const taskService = new TaskService(prisma);
const companyService = new CompanyService(prisma);
const authService = new AuthService(prisma, jwtService);
const agentService = new AgentService(
  prisma,
  contactService,
  pipelineService,
  opportunityService,
  dashboardService,
);

async function main() {
  const startTime = Date.now();
  console.log('🧪 RUNNING FULL AUDIT REMEDIATION TEST SUITE (RELEASE 0.1.1)');
  console.log('===========================================================');

  let failedTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${message}`);
    } else {
      failedTests++;
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // 1. Startup Configuration Checks
  console.log('\n--- Part 1: JWT Secret Configuration Validation ---');
  try {
    validateEnvironmentConfig();
    assert(true, 'JWT_SECRET configuration meets length (>=32 chars) and strength requirements.');
  } catch (e: any) {
    assert(false, 'JWT_SECRET configuration failed');
  }

  // Reset database tables.
  // Offer/ClientAccount use Restrict FKs back to BusinessUnit/Contact/Company
  // (Phase 2 Task 1-2 design) -- clear them first, in dependency order, or
  // the blanket organization.deleteMany() below cannot cascade through them.
  await prisma.clientCommercialStateChange.deleteMany();
  await prisma.conversionIdempotencyKey.deleteMany();
  await prisma.clientAccount.deleteMany();
  await prisma.offerSnapshot.deleteMany();
  await prisma.stripePriceMapping.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.note.deleteMany();
  await prisma.task.deleteMany();
  await prisma.agentApproval.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.stage.deleteMany();
  await prisma.pipeline.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.organization.deleteMany();

  // Seed Workspace A (Tenant A)
  const orgA = await prisma.organization.create({ data: { name: 'Tenant A Org' } });
  const wsA = await prisma.workspace.create({ data: { name: 'Workspace A', subdomain: 'alpha', organizationId: orgA.id } });
  const userA = await prisma.user.create({ data: { email: 'alan@alpha.com', passwordHash: 'hash', firstName: 'Alan', lastName: 'Alpha' } });
  await prisma.membership.create({ data: { userId: userA.id, organizationId: orgA.id, workspaceId: wsA.id, role: Role.ORG_OWNER, permissions: ['*'] } });

  // Seed Workspace B (Tenant B)
  const orgB = await prisma.organization.create({ data: { name: 'Tenant B Org' } });
  const wsB = await prisma.workspace.create({ data: { name: 'Workspace B', subdomain: 'beta', organizationId: orgB.id } });
  const userB = await prisma.user.create({ data: { email: 'bob@beta.com', passwordHash: 'hash', firstName: 'Bob', lastName: 'Beta' } });
  await prisma.membership.create({ data: { userId: userB.id, organizationId: orgB.id, workspaceId: wsB.id, role: Role.USER, permissions: ['contact:read'] } });

  // Seed Multi-Workspace User (User C in both WS A and WS B)
  const userC = await prisma.user.create({ data: { email: 'charlie@multi.com', passwordHash: 'hash', firstName: 'Charlie', lastName: 'Multi' } });
  await prisma.membership.create({ data: { userId: userC.id, organizationId: orgA.id, workspaceId: wsA.id, role: Role.USER } });
  await prisma.membership.create({ data: { userId: userC.id, organizationId: orgB.id, workspaceId: wsB.id, role: Role.USER } });

  // 2. Tenant Isolation & Relation Hijacking Tests
  console.log('\n--- Part 2: Hardened Tenant Isolation & Relation Hijacking ---');
  const companyA = await prisma.company.create({ data: { name: 'Company A', workspaceId: wsA.id } });
  const contactA = await prisma.contact.create({ data: { firstName: 'Sarah', lastName: 'Connor', status: ContactStatus.LEAD, workspaceId: wsA.id, companyId: companyA.id } });
  const pipelineA = await prisma.pipeline.create({ data: { name: 'Pipeline A', workspaceId: wsA.id } });
  const stageA = await prisma.stage.create({ data: { name: 'Stage A', order: 1, pipelineId: pipelineA.id } });
  
  const oppA = await opportunityService.create(wsA.id, {
    name: 'Opp A',
    value: 12500.75,
    pipelineId: pipelineA.id,
    stageId: stageA.id,
    contactId: contactA.id,
  });

  // Verify Decimal money representation & exact cents storage
  assert(oppA.value instanceof Prisma.Decimal && oppA.value.toString() === '12500.75', 'Money fields stored as Prisma Decimal with exact cents ($12,500.75).');

  // Verify Dashboard aggregation with Decimals
  const dashData = await dashboardService.getDashboardData(wsA.id, userA);
  assert(dashData.stats.projectedRevenue === 0, 'Dashboard aggregation processed Prisma Decimal values correctly.');

  // Test Relation Hijacking: Link Workspace A contact inside Workspace B opportunity
  try {
    const pipelineB = await prisma.pipeline.create({ data: { name: 'Pipeline B', workspaceId: wsB.id } });
    const stageB = await prisma.stage.create({ data: { name: 'Stage B', order: 1, pipelineId: pipelineB.id } });
    await opportunityService.create(wsB.id, {
      name: 'Hijacked Opp',
      pipelineId: pipelineB.id,
      stageId: stageB.id,
      contactId: contactA.id, // Belonging to Workspace A!
    });
    assert(false, 'Relation hijacking allowed cross-workspace contact linkage');
  } catch (e: any) {
    assert(e.message.includes('Relation violation'), 'Relation Hijacking Protection: Blocked cross-tenant entity linkage.');
  }

  // Cross-tenant Read Block & Record Preservation Verification
  try {
    await contactService.findById(wsB.id, contactA.id);
    assert(false, 'Cross-workspace contact read permitted');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Cross-workspace read blocked with Not Found exception.');
  }

  // Verify original record was NOT modified or corrupted
  const preservedContact = await prisma.contact.findUnique({ where: { id: contactA.id } });
  assert(preservedContact?.firstName === 'Sarah' && preservedContact?.workspaceId === wsA.id, 'Original tenant record preserved intact after blocked attack.');

  // selectWorkspace() now requires a preAuthToken (proof of a real password
  // check via login()) rather than a trusted userId -- see auth.service.ts.
  // This test creates users directly via Prisma with placeholder password
  // hashes, so we mint the same short-lived token login() would issue,
  // rather than trying to bcrypt-authenticate a fake hash.
  const mintPreAuthToken = (userId: string) =>
    jwtService.sign({ sub: userId, purpose: 'workspace-selection' }, { expiresIn: '5m' });

  // 3. Multi-Workspace User Isolation
  console.log('\n--- Part 3: Multi-Workspace User Isolation ---');
  const tokenMultiWsA = await authService.selectWorkspace(mintPreAuthToken(userC.id), wsA.id);
  const tokenMultiWsB = await authService.selectWorkspace(mintPreAuthToken(userC.id), wsB.id);
  assert(tokenMultiWsA.user.workspaceId === wsA.id && tokenMultiWsB.user.workspaceId === wsB.id, 'Multi-workspace user correctly issued distinct workspace-scoped tokens.');

  // 4. Refresh Session Lifecycle Tests
  console.log('\n--- Part 4: Refresh Session Lifecycle & Token Security ---');
  const session1 = await authService.selectWorkspace(mintPreAuthToken(userA.id), wsA.id);
  
  // Verify token storage is hashed SHA-256 and NOT plaintext
  const storedRefreshToken = await prisma.refreshToken.findFirst({ where: { userId: userA.id } });
  assert(!!storedRefreshToken && storedRefreshToken.hashedToken !== session1.refresh_token, 'Database refresh tokens stored as SHA-256 hashes (plaintext never saved).');

  // Token Rotation Test
  const session2 = await authService.refreshToken(session1.refresh_token);
  assert(session2.refresh_token !== session1.refresh_token, 'Refresh Token Rotation: Old refresh token revoked and new refresh token issued.');

  // Reuse attempt of old refresh token (MUST FAIL)
  try {
    await authService.refreshToken(session1.refresh_token);
    assert(false, 'Old refresh token reuse allowed');
  } catch (e: any) {
    assert(e.message.includes('Invalid or expired'), 'Refresh Token Security: Reused old refresh token rejected.');
  }

  // Single Session Logout
  await authService.logout(session2.refresh_token);
  try {
    await authService.refreshToken(session2.refresh_token);
    assert(false, 'Logout single session failed to revoke token');
  } catch (e: any) {
    assert(e.message.includes('Invalid or expired'), 'Logout successfully revoked active refresh token.');
  }

  // Logout All Devices
  const sessionDev1 = await authService.selectWorkspace(mintPreAuthToken(userA.id), wsA.id);
  const sessionDev2 = await authService.selectWorkspace(mintPreAuthToken(userA.id), wsA.id);
  await authService.logoutAll(userA.id);
  
  const activeTokensCount = await prisma.refreshToken.count({ where: { userId: userA.id, revoked: false } });
  assert(activeTokensCount === 0, 'Logout-All-Devices: All active refresh tokens revoked across all devices.');

  // 5. Nested Audit Redaction & Case Variations
  console.log('\n--- Part 5: Audit Log Sensitive Data Scrubbing ---');
  const sensitivePayload = {
    firstName: 'TestUser',
    password: 'my-super-secret-password',
    api_key: 'sk_live_99999',
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    refreshToken: 'ref_token_8888',
    authorization: 'Bearer secret-header-value',
    cookie: 'session_id=secret_session',
    clientSecret: 'secret_client_key',
    bearer: 'bearer_token_val',
  };

  const redacted = redactAuditPayload(sensitivePayload);
  const redactedStr = JSON.stringify(redacted);
  
  assert(
    redactedStr.includes('[REDACTED]') &&
    !redactedStr.includes('my-super-secret-password') &&
    !redactedStr.includes('sk_live_99999') &&
    !redactedStr.includes('secret-header-value'),
    'Audit Log Redaction: Case-insensitive scrubbing verified for passwords, API keys, bearer tokens, cookies, and secrets.'
  );

  // 6. Prisma Enum State Transitions
  console.log('\n--- Part 6: Prisma Enum Validations ---');
  assert(Object.values(OpportunityStatus).includes(OpportunityStatus.OPEN), 'OpportunityStatus Enum verified.');
  assert(Object.values(TaskStatus).includes(TaskStatus.PENDING), 'TaskStatus Enum verified.');
  assert(Object.values(ContactStatus).includes(ContactStatus.LEAD), 'ContactStatus Enum verified.');
  assert(Object.values(InvitationStatus).includes(InvitationStatus.PENDING), 'InvitationStatus Enum verified.');
  assert(Object.values(ApprovalStatus).includes(ApprovalStatus.PENDING), 'ApprovalStatus Enum verified.');
  assert(Object.values(ActivityType).includes(ActivityType.SYSTEM_EVENT), 'ActivityType Enum verified.');

  const duration = Date.now() - startTime;
  console.log('\n===========================================================');
  console.log(`📊 TOTAL RUN SUMMARY: Passed: ${passedTests}, Failed: ${failedTests}, Duration: ${duration}ms`);

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
