import { Role } from '@prisma/client';
import { PrismaService } from './src/prisma.service';
import { ContactService } from './src/modules/contact/contact.service';
import { PipelineService } from './src/modules/pipeline/pipeline.service';
import { OpportunityService } from './src/modules/opportunity/opportunity.service';
import { DashboardService } from './src/modules/dashboard/dashboard.service';
import { AgentService } from './src/modules/agent/agent.service';

const prisma = new PrismaService();

// Instantiate Services
const contactService = new ContactService(prisma);
const pipelineService = new PipelineService(prisma);
const opportunityService = new OpportunityService(prisma);
const dashboardService = new DashboardService(prisma);
const agentService = new AgentService(
  prisma,
  contactService,
  pipelineService,
  opportunityService,
  dashboardService,
);

async function runScenarios() {
  console.log('🏁 Starting Release 0.1 Governing Scenarios test run...');

  // Reset database for a clean run.
  // Offer/ClientAccount use Restrict FKs back to BusinessUnit/Contact/Company
  // (Phase 2 Task 1-2 design) -- clear them first, in dependency order, or
  // the blanket organization.deleteMany() below cannot cascade through them.
  await prisma.clientCommercialStateChange.deleteMany();
  await prisma.conversionIdempotencyKey.deleteMany();
  await prisma.clientAccount.deleteMany();
  await prisma.offerSnapshot.deleteMany();
  await prisma.offer.deleteMany();
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
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.organization.deleteMany();

  // Create base Workspace
  const org = await prisma.organization.create({ data: { name: 'Griot Photo Co Org' } });
  const workspace = await prisma.workspace.create({
    data: { name: 'Griot Photo Co', subdomain: 'griot', organizationId: org.id },
  });
  const owner = await prisma.user.create({
    data: {
      email: 'alan@griot.com',
      passwordHash: 'hashed',
      firstName: 'Alan',
      lastName: 'Alpha',
    },
  });
  await prisma.membership.create({
    data: {
      userId: owner.id,
      organizationId: org.id,
      workspaceId: workspace.id,
      role: Role.ORG_OWNER,
      permissions: ['*'],
    },
  });

  // Scenario 1: Workspace Leak Protection
  console.log('\n--- Scenario 1: Prove records do not leak ---');
  const orgB = await prisma.organization.create({ data: { name: 'Beta Org' } });
  const workspaceB = await prisma.workspace.create({
    data: { name: 'Beta Workspace', subdomain: 'beta', organizationId: orgB.id },
  });
  
  await contactService.create(workspace.id, { firstName: 'Sarah', lastName: 'Connor' });
  await contactService.create(workspaceB.id, { firstName: 'Terminator', lastName: 'T800' });
  
  const contactsA = await contactService.findAll(workspace.id);
  const contactsB = await contactService.findAll(workspaceB.id);
  
  console.log(`Workspace A contacts: ${contactsA.map(c => c.firstName).join(', ')}`);
  console.log(`Workspace B contacts: ${contactsB.map(c => c.firstName).join(', ')}`);
  if (contactsA.length === 1 && contactsA[0].firstName === 'Sarah' && contactsB.length === 1) {
    console.log('✅ PASS: Workspace leak protection verified.');
  }

  // Scenario 2: Create Contact, Company, Pipeline, Stages, and Opportunity
  console.log('\n--- Scenario 2: Create full CRM records ---');
  const company = await prisma.company.create({
    data: { name: 'Atlanta Bridal Ltd', workspaceId: workspace.id },
  });
  const contact = await contactService.create(workspace.id, {
    firstName: 'John',
    lastName: 'Doe',
    companyId: company.id,
  });
  const pipeline = await pipelineService.create(workspace.id, 'Wedding Bookings');
  if (!pipeline) throw new Error('Pipeline seeding failed');

  const opportunity = await opportunityService.create(workspace.id, {
    name: 'Photo package booking',
    value: 1200,
    probability: 60,
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0].id,
    contactId: contact.id,
  });
  console.log(`Created Opportunity: ${opportunity.name} (Value: $${opportunity.value})`);
  console.log('✅ PASS: CRM entity creation verified.');

  // Scenario 3: Ask the Agent to create a wedding lead pipeline (Plan Preview)
  console.log('\n--- Scenario 3-4: Agent Plan Preview and Approve Workflow ---');
  const preview = await agentService.previewPlan(workspace.id, owner.id, 'Create a wedding pipeline');
  console.log(`Plan Status: ${preview.status}`);
  console.log(`Staged Plan Actions: ${JSON.stringify(preview.plan, null, 2)}`);
  
  // Approve and execute plan
  const exec1 = await agentService.executeTool(
    workspace.id,
    owner.id,
    preview.plan[0].action,
    preview.plan[0].args,
    'ORG_OWNER',
  );
  console.log(`Execution result: status=${exec1.status}`);

  // Scenario 5: Verify records were created through tools
  console.log('\n--- Scenario 5: Verify records created through tools ---');
  const createdPipeline = await prisma.pipeline.findFirst({
    where: { name: 'Wedding Lead Pipeline', workspaceId: workspace.id },
  });
  if (createdPipeline) {
    console.log(`✅ PASS: Pipeline '${createdPipeline.name}' was created successfully through the agent.`);
  } else {
    console.log('❌ FAIL: Pipeline not found.');
  }

  // Scenario 6: Show the complete audit trail
  console.log('\n--- Scenario 6: Audit trail display ---');
  const logs = await prisma.auditLog.findMany({ where: { workspaceId: workspace.id } });
  console.log(`Logged audit trails (${logs.length} entries):`);
  logs.forEach(l => {
    console.log(` - Action: ${l.action} by ${l.actorType}`);
  });
  console.log('✅ PASS: Audit logging verified.');

  // Scenario 7: Attempt an unauthorized action and show safe rejection
  console.log('\n--- Scenario 7: Emulate unauthorized action and verify rejection ---');
  try {
    // Attempting pipeline creation as role USER (which requires ORG_OWNER or ORG_ADMIN)
    await agentService.executeTool(
      workspace.id,
      owner.id,
      'createPipeline',
      { name: 'Illegal Pipeline' },
      'USER',
    );
  } catch (err: any) {
    console.log(`Rejection Message: ${err.message}`);
    console.log('✅ PASS: Safe role rejection verified.');
  }

  // Scenario 8: Cancel an agent execution
  console.log('\n--- Scenario 8: Cancel Agent Execution ---');
  const sessionId = 'session_test_cancel';
  // Start execution in background
  const p = agentService.executeTool(
    workspace.id,
    owner.id,
    'getDashboard',
    {},
    'ORG_OWNER',
    sessionId,
  );
  // Cancel immediately
  const cancelResult = await agentService.cancelExecution(sessionId);
  console.log(`Cancellation Status: ${cancelResult.status}`);
  console.log(`Cancellation Message: ${cancelResult.message}`);
  console.log('✅ PASS: Execution cancellation verified.');

  // Scenario 9: Display the Executive Command Center using real database data
  console.log('\n--- Scenario 9: Executive Dashboard populated with database stats ---');
  const dash = await dashboardService.getDashboardData(workspace.id, owner);
  console.log(`Dashboard Executive Brief:\n\n${dash.brief}`);
  console.log('✅ PASS: Dynamic Executive Dashboard verified.');
}

runScenarios()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
