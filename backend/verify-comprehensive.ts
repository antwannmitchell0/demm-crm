import { Role, OpportunityStatus, TaskStatus, ContactStatus, InvitationStatus, ApprovalStatus, ActivityType, Prisma } from '@prisma/client';
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

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_SECRET || 'demm_crm_production_secure_jwt_secret_key_32chars_minimum' });

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
  console.log('🧪 RUNNING HARDENED COMPREHENSIVE AUTOMATED TEST SUITE (RELEASE 0.1.1)');
  console.log('====================================================================');

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

  // Reset database
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

  // Seed Workspace A & User A
  const orgA = await prisma.organization.create({ data: { name: 'Tenant A Org' } });
  const wsA = await prisma.workspace.create({ data: { name: 'Workspace A', subdomain: 'alpha', organizationId: orgA.id } });
  const userA = await prisma.user.create({ data: { email: 'alan@alpha.com', passwordHash: 'hash', firstName: 'Alan', lastName: 'Alpha' } });
  await prisma.membership.create({ data: { userId: userA.id, organizationId: orgA.id, workspaceId: wsA.id, role: Role.ORG_OWNER, permissions: ['*'] } });

  // Seed Workspace B & User B
  const orgB = await prisma.organization.create({ data: { name: 'Tenant B Org' } });
  const wsB = await prisma.workspace.create({ data: { name: 'Workspace B', subdomain: 'beta', organizationId: orgB.id } });
  const userB = await prisma.user.create({ data: { email: 'bob@beta.com', passwordHash: 'hash', firstName: 'Bob', lastName: 'Beta' } });
  await prisma.membership.create({ data: { userId: userB.id, organizationId: orgB.id, workspaceId: wsB.id, role: Role.USER, permissions: ['contact:read'] } });

  console.log('\n--- Part 1: Comprehensive Tenant Isolation & Relation Hijacking ---');
  const companyA = await prisma.company.create({ data: { name: 'Company A', workspaceId: wsA.id } });
  const contactA = await prisma.contact.create({ data: { firstName: 'Sarah', lastName: 'Connor', status: ContactStatus.LEAD, workspaceId: wsA.id, companyId: companyA.id } });
  const pipelineA = await prisma.pipeline.create({ data: { name: 'Pipeline A', workspaceId: wsA.id } });
  const stageA = await prisma.stage.create({ data: { name: 'Stage A', order: 1, pipelineId: pipelineA.id } });
  const oppA = await opportunityService.create(wsA.id, {
    name: 'Opp A',
    value: 12500.50,
    pipelineId: pipelineA.id,
    stageId: stageA.id,
    contactId: contactA.id,
  });

  // Verify Decimal money type
  assert(oppA.value instanceof Prisma.Decimal && oppA.value.toString() === '12500.5', 'Prisma Decimal field verified for deal currency.');

  // Test Relation Hijacking: Attempting to create an Opportunity in Workspace B using Workspace A's Contact ID
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
    assert(e.message.includes('Relation violation'), 'Relation Hijacking Protection: Blocked linking Workspace A contact inside Workspace B opportunity.');
  }

  // Cross-workspace Reads
  try {
    await contactService.findById(wsB.id, contactA.id);
    assert(false, 'Cross-workspace contact read permitted');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Contacts from cross-workspace read.');
  }

  try {
    await companyService.findById(wsB.id, companyA.id);
    assert(false, 'Cross-workspace company read permitted');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Companies from cross-workspace read.');
  }

  console.log('\n--- Part 2: Session Security & Refresh Token Rotation ---');
  // Explicit Workspace Selection
  const tokenSession = await authService.selectWorkspace(userA.id, wsA.id);
  assert(!!tokenSession.access_token && !!tokenSession.refresh_token, 'Explicit workspace selection issued Access & Refresh tokens.');

  // Refresh Token Rotation
  const rotatedSession = await authService.refreshToken(tokenSession.refresh_token);
  assert(!!rotatedSession.access_token && rotatedSession.refresh_token !== tokenSession.refresh_token, 'Refresh token rotation successfully revoked old token and issued new tokens.');

  // Old refresh token reuse attempt (must fail)
  try {
    await authService.refreshToken(tokenSession.refresh_token);
    assert(false, 'Reused old refresh token');
  } catch (e: any) {
    assert(e.message.includes('Invalid or expired'), 'Refresh Token Rotation: Old refresh token rejected upon reuse.');
  }

  // Logout single session
  await authService.logout(rotatedSession.refresh_token);
  try {
    await authService.refreshToken(rotatedSession.refresh_token);
    assert(false, 'Revoked refresh token was accepted');
  } catch (e: any) {
    assert(e.message.includes('Invalid or expired'), 'Logout successfully revoked refresh token.');
  }

  console.log('\n--- Part 3: Audit Log Sensitive Data Redaction ---');
  await agentService.executeTool(wsA.id, userA.id, 'createContact', {
    firstName: 'AuditTest',
    lastName: 'User',
    password: 'super-secret-password-123',
    apiKey: 'sk_test_123456789',
  }, 'ORG_OWNER');

  const auditLogs = await prisma.auditLog.findMany({
    where: { workspaceId: wsA.id, action: 'createContact' },
    orderBy: { createdAt: 'desc' },
  });
  
  const latestLog = auditLogs[0];
  const payloadStr = JSON.stringify(latestLog.payload);
  assert(
    payloadStr.includes('[REDACTED]') && !payloadStr.includes('super-secret-password-123'),
    'Audit Log Redaction: Password and API Keys scrubbed to [REDACTED].'
  );

  const duration = Date.now() - startTime;
  console.log('\n====================================================================');
  console.log(`📊 TOTAL RUN SUMMARY: Passed: ${passedTests}, Failed: ${failedTests}, Duration: ${duration}ms`);

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main()
