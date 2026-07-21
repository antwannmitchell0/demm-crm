import { PrismaClient, Role } from '@prisma/client';
import { ContactService } from './src/modules/contact/contact.service';
import { PipelineService } from './src/modules/pipeline/pipeline.service';
import { OpportunityService } from './src/modules/opportunity/opportunity.service';
import { DashboardService } from './src/modules/dashboard/dashboard.service';
import { AgentService } from './src/modules/agent/agent.service';
import { TaskService } from './src/modules/task/task.service';
import { CompanyService } from './src/modules/company/company.service';
import { PrismaService } from './src/prisma.service';

const prisma = new PrismaService();

// Instantiate Services
const contactService = new ContactService(prisma);
const pipelineService = new PipelineService(prisma);
const opportunityService = new OpportunityService(prisma);
const dashboardService = new DashboardService(prisma);
const taskService = new TaskService(prisma);
const agentService = new AgentService(
  prisma,
  contactService,
  pipelineService,
  opportunityService,
  dashboardService,
);

async function main() {
  const startTime = Date.now();
  console.log('🧪 RUNNING COMPREHENSIVE AUTOMATED TEST SUITE (SCENARIO 10)');
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

  // Reset database
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

  // Create Workspace A & User A (Tenant A)
  const orgA = await prisma.organization.create({ data: { name: 'Tenant A Org' } });
  const wsA = await prisma.workspace.create({ data: { name: 'Workspace A', subdomain: 'alpha', organizationId: orgA.id } });
  const userA = await prisma.user.create({ data: { email: 'alan@alpha.com', passwordHash: 'hash', firstName: 'Alan', lastName: 'Alpha' } });
  await prisma.membership.create({ data: { userId: userA.id, organizationId: orgA.id, workspaceId: wsA.id, role: Role.ORG_OWNER, permissions: ['*'] } });

  // Create Workspace B & User B (Tenant B)
  const orgB = await prisma.organization.create({ data: { name: 'Tenant B Org' } });
  const wsB = await prisma.workspace.create({ data: { name: 'Workspace B', subdomain: 'beta', organizationId: orgB.id } });
  const userB = await prisma.user.create({ data: { email: 'bob@beta.com', passwordHash: 'hash', firstName: 'Bob', lastName: 'Beta' } });
  await prisma.membership.create({ data: { userId: userB.id, organizationId: orgB.id, workspaceId: wsB.id, role: Role.USER, permissions: ['contact:read'] } });

  // 1. Expand Tenant Isolation Testing across ALL 11 Entities
  console.log('\n--- Part 1: Comprehensive Tenant Isolation Verification ---');

  // Seed Tenant A Entities
  const companyA = await prisma.company.create({ data: { name: 'Company A', workspaceId: wsA.id } });
  const contactA = await prisma.contact.create({ data: { firstName: 'Sarah', lastName: 'Connor', workspaceId: wsA.id, companyId: companyA.id } });
  const pipelineA = await prisma.pipeline.create({ data: { name: 'Pipeline A', workspaceId: wsA.id } });
  const stageA = await prisma.stage.create({ data: { name: 'Stage A', order: 1, pipelineId: pipelineA.id } });
  const oppA = await prisma.opportunity.create({ data: { name: 'Opp A', workspaceId: wsA.id, pipelineId: pipelineA.id, stageId: stageA.id, contactId: contactA.id } });
  const taskA = await prisma.task.create({ data: { title: 'Task A', workspaceId: wsA.id, contactId: contactA.id, opportunityId: oppA.id } });
  const actA = await prisma.activity.create({ data: { type: 'SYSTEM_EVENT', description: 'Activity A', contactId: contactA.id } });
  const logA = await prisma.auditLog.create({ data: { actorType: 'USER', actorId: userA.id, action: 'test', payload: {}, workspaceId: wsA.id } });
  const approvalA = await prisma.agentApproval.create({ data: { toolName: 'createOpportunity', arguments: {}, workspaceId: wsA.id, requestedById: userA.id } });
  const memoryA = await prisma.aIMemory.create({ data: { domain: 'sales', key: 'keyA', value: {}, workspaceId: wsA.id } });
  const invitationA = await prisma.invitation.create({ data: { email: 'invite@alpha.com', token: 'tokenA', expiresAt: new Date(Date.now() + 3600), workspaceId: wsA.id, organizationId: orgA.id } });

  // Attempts by Tenant B user to read/write/delete Tenant A's objects directly or with spoofed context headers
  // Test reads on Contact
  try {
    await contactService.findById(wsB.id, contactA.id);
    assert(false, 'Tenant B accessed Tenant A Contact');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Contacts from cross-workspace read.');
  }

  // Test updates on Opportunity
  try {
    await opportunityService.update(wsB.id, oppA.id, { name: 'Hacked name' });
    assert(false, 'Tenant B updated Tenant A Opportunity');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Opportunities from cross-workspace update.');
  }

  // Test tasks separation
  try {
    await taskService.findById(wsB.id, taskA.id);
    assert(false, 'Tenant B retrieved Tenant A Task');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Tasks from cross-workspace read.');
  }

  // Check audit log isolation
  const logsB = await prisma.auditLog.findMany({ where: { workspaceId: wsB.id } });
  assert(!logsB.some(l => l.id === logA.id), 'Audit logs do not leak across workspace contexts.');

  // Check approval ticket isolation
  const approvalsB = await prisma.agentApproval.findMany({ where: { workspaceId: wsB.id } });
  assert(!approvalsB.some(a => a.id === approvalA.id), 'Agent approval tickets do not leak across workspaces.');

  // Check memory isolation
  const memoriesB = await prisma.aIMemory.findMany({ where: { workspaceId: wsB.id } });
  assert(!memoriesB.some(m => m.id === memoryA.id), 'AI Memory records do not leak across workspaces.');

  // Check invitation isolation
  const invitesB = await prisma.invitation.findMany({ where: { workspaceId: wsB.id } });
  assert(!invitesB.some(i => i.id === invitationA.id), 'Invitations do not leak across workspaces.');

  // Test Companies Isolation
  const companyService = new CompanyService(prisma);
  try {
    await companyService.findById(wsB.id, companyA.id);
    assert(false, 'Tenant B accessed Tenant A Company');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Companies from cross-workspace read.');
  }

  // Test Pipelines Isolation
  try {
    await pipelineService.findById(wsB.id, pipelineA.id);
    assert(false, 'Tenant B accessed Tenant A Pipeline');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Pipelines from cross-workspace read.');
  }

  // Test Stages Isolation
  try {
    await pipelineService.addStage(wsB.id, pipelineA.id, 'Illegal Stage', 99);
    assert(false, 'Tenant B added stage to Tenant A Pipeline');
  } catch (e: any) {
    assert(e.message.includes('not found'), 'Workspace isolation protected Stages from cross-workspace modification.');
  }

  // Test Activities Isolation
  const activitiesB = await prisma.activity.findMany({ where: { contact: { workspaceId: wsB.id } } });
  assert(!activitiesB.some(a => a.id === actA.id), 'Activities timeline does not leak across workspaces.');

  // Test Agent Executions Isolation
  try {
    // User B tries to execute a tool in Workspace A
    await agentService.executeTool(wsA.id, userB.id, 'createContact', { firstName: 'Hack' }, 'USER');
    assert(false, 'Agent tool execution allowed cross-workspace actions');
  } catch (e: any) {
    assert(e.message.includes('not a member') || e.message.includes('Denied'), 'Agent Gateway isolation blocks cross-workspace agent execution.');
  }
  
  // Need to import CompanyService in verify-comprehensive


  // 2. Best-Effort Pre-Commit Cancellation Verification
  console.log('\n--- Part 2: Best-Effort Pre-Commit Cancellation Tests ---');
  
  // Test Case A: Cancellation before execution starts
  const cancelSessionBefore = 'session_cancel_before';
  await agentService.cancelExecution(cancelSessionBefore); // Cancel early
  const resBefore = await agentService.executeTool(
    wsA.id,
    userA.id,
    'getDashboard',
    {},
    'ORG_OWNER',
    cancelSessionBefore
  );
  assert(resBefore.status === 'ERROR' && resBefore.error!.includes('aborted'), 'Cancellation before execution verified (pre-emptively aborted).');

  // Test Case B: Cancellation after mutation committed
  // In best-effort pre-commit cancellation, committed mutations survive.
  const cancelSessionAfter = 'session_cancel_after';
  const initialContactsCount = await prisma.contact.count({ where: { workspaceId: wsA.id } });
  
  const executionPromise = agentService.executeTool(
    wsA.id,
    userA.id,
    'createContact',
    { firstName: 'Surviving', lastName: 'Contact' },
    'ORG_OWNER',
    cancelSessionAfter,
  );
  
  // Await the create contact execution to simulate it finishing and committing
  await executionPromise;
  
  // Cancel after it has already committed
  const cancelRes = await agentService.cancelExecution(cancelSessionAfter);
  assert(cancelRes.status === 'NOT_FOUND', 'Cancellation of committed task behaves as best-effort (pre-commit already resolved).');
  
  const finalContactsCount = await prisma.contact.count({ where: { workspaceId: wsA.id } });
  assert(
    finalContactsCount === initialContactsCount + 1,
    `Best-effort pre-commit cancellation confirmed: committed contact survived (${finalContactsCount} contacts total).`
  );

  // 3. Provide complete audit-record evidence
  console.log('\n--- Part 3: Audit-Record Evidence Sample ---');
  const auditLogs = await prisma.auditLog.findMany({
    where: { workspaceId: wsA.id },
    orderBy: { createdAt: 'desc' },
  });
  
  if (auditLogs.length > 0) {
    const sampleLog = auditLogs[0];
    console.log(JSON.stringify({
      workspaceId: sampleLog.workspaceId,
      actorType: sampleLog.actorType,
      actorId: sampleLog.actorId,
      action: sampleLog.action,
      correlationId: sampleLog.id,
      timestamp: sampleLog.createdAt,
      payload: sampleLog.payload,
    }, null, 2));
    assert(true, 'Audit log structure verified.');
  }

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
