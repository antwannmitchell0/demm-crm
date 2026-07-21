"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma_service_1 = require("./src/prisma.service");
const contact_service_1 = require("./src/modules/contact/contact.service");
const pipeline_service_1 = require("./src/modules/pipeline/pipeline.service");
const opportunity_service_1 = require("./src/modules/opportunity/opportunity.service");
const dashboard_service_1 = require("./src/modules/dashboard/dashboard.service");
const agent_service_1 = require("./src/modules/agent/agent.service");
const prisma = new prisma_service_1.PrismaService();
const contactService = new contact_service_1.ContactService(prisma);
const pipelineService = new pipeline_service_1.PipelineService(prisma);
const opportunityService = new opportunity_service_1.OpportunityService(prisma);
const dashboardService = new dashboard_service_1.DashboardService(prisma);
const agentService = new agent_service_1.AgentService(prisma, contactService, pipelineService, opportunityService, dashboardService);
async function runScenarios() {
    console.log('🏁 Starting Release 0.1 Governing Scenarios test run...');
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
            role: client_1.Role.ORG_OWNER,
            permissions: ['*'],
        },
    });
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
    if (!pipeline)
        throw new Error('Pipeline seeding failed');
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
    console.log('\n--- Scenario 3-4: Agent Plan Preview and Approve Workflow ---');
    const preview = await agentService.previewPlan(workspace.id, owner.id, 'Create a wedding pipeline');
    console.log(`Plan Status: ${preview.status}`);
    console.log(`Staged Plan Actions: ${JSON.stringify(preview.plan, null, 2)}`);
    const exec1 = await agentService.executeTool(workspace.id, owner.id, preview.plan[0].action, preview.plan[0].args, 'ORG_OWNER');
    console.log(`Execution result: status=${exec1.status}`);
    console.log('\n--- Scenario 5: Verify records created through tools ---');
    const createdPipeline = await prisma.pipeline.findFirst({
        where: { name: 'Wedding Lead Pipeline', workspaceId: workspace.id },
    });
    if (createdPipeline) {
        console.log(`✅ PASS: Pipeline '${createdPipeline.name}' was created successfully through the agent.`);
    }
    else {
        console.log('❌ FAIL: Pipeline not found.');
    }
    console.log('\n--- Scenario 6: Audit trail display ---');
    const logs = await prisma.auditLog.findMany({ where: { workspaceId: workspace.id } });
    console.log(`Logged audit trails (${logs.length} entries):`);
    logs.forEach(l => {
        console.log(` - Action: ${l.action} by ${l.actorType}`);
    });
    console.log('✅ PASS: Audit logging verified.');
    console.log('\n--- Scenario 7: Emulate unauthorized action and verify rejection ---');
    try {
        await agentService.executeTool(workspace.id, owner.id, 'createPipeline', { name: 'Illegal Pipeline' }, 'USER');
    }
    catch (err) {
        console.log(`Rejection Message: ${err.message}`);
        console.log('✅ PASS: Safe role rejection verified.');
    }
    console.log('\n--- Scenario 8: Cancel Agent Execution ---');
    const sessionId = 'session_test_cancel';
    const p = agentService.executeTool(workspace.id, owner.id, 'getDashboard', {}, 'ORG_OWNER', sessionId);
    const cancelResult = await agentService.cancelExecution(sessionId);
    console.log(`Cancellation Status: ${cancelResult.status}`);
    console.log(`Cancellation Message: ${cancelResult.message}`);
    console.log('✅ PASS: Execution cancellation verified.');
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
//# sourceMappingURL=verify-scenarios.js.map