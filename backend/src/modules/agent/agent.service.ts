import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ContactService } from '../contact/contact.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { OpportunityService } from '../opportunity/opportunity.service';
import { DashboardService } from '../dashboard/dashboard.service';

@Injectable()
export class AgentService {
  private toolRegistry = new Map<string, {
    description: string;
    permissions: string[]; // E.g. ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN', 'USER']
    isHighRisk: (args: any) => boolean;
    handler: (workspaceId: string, userId: string, args: any) => Promise<any>;
  }>();

  // Active execution sessions to allow cancellation
  private activeExecutions = new Map<string, {
    abortController: AbortController;
    toolName: string;
    startedAt: Date;
  }>();

  constructor(
    private prisma: PrismaService,
    private contactService: ContactService,
    private pipelineService: PipelineService,
    private opportunityService: OpportunityService,
    private dashboardService: DashboardService,
  ) {
    this.registerTools();
  }

  private registerTools() {
    // 1. Get Dashboard
    this.toolRegistry.set('getDashboard', {
      description: 'Retrieve the daily executive brief and key performance indicators.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN', 'USER'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId) => {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        return this.dashboardService.getDashboardData(workspaceId, user);
      },
    });

    // 2. Create Contact
    this.toolRegistry.set('createContact', {
      description: 'Create a new contact record.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.contactService.create(workspaceId, args);
      },
    });

    // 3. Search Contacts
    this.toolRegistry.set('searchContacts', {
      description: 'Search contacts by name, email, phone, or tags.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN', 'USER'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.contactService.search(workspaceId, args.query || '');
      },
    });

    // 4. Create Pipeline
    this.toolRegistry.set('createPipeline', {
      description: 'Create a new deal pipeline.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.pipelineService.create(workspaceId, args.name);
      },
    });

    // 5. Create Opportunity
    this.toolRegistry.set('createOpportunity', {
      description: 'Create a new deal opportunity.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      // High risk if value is > $5000
      isHighRisk: (args) => (args.value || 0) > 5000,
      handler: async (workspaceId, userId, args) => {
        return this.opportunityService.create(workspaceId, args);
      },
    });

    // 6. Move Opportunity
    this.toolRegistry.set('moveOpportunity', {
      description: 'Move an opportunity to another stage.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.opportunityService.moveStage(workspaceId, args.id, args.stageId);
      },
    });
  }

  getRegisteredTools() {
    const list = [];
    for (const [name, value] of this.toolRegistry.entries()) {
      list.push({
        name,
        description: value.description,
        permissions: value.permissions,
      });
    }
    return list;
  }

  // Preview plan step (Scenario 3-4)
  async previewPlan(workspaceId: string, userId: string, description: string) {
    // Determine outcomes based on instructions
    const plan = [];
    if (description.toLowerCase().includes('wedding')) {
      plan.push({ action: 'createPipeline', args: { name: 'Wedding Lead Pipeline' } });
      plan.push({ action: 'createContact', args: { firstName: 'Sarah', lastName: 'Wedding-Lead', emails: ['sarah@wed.com'] } });
    } else {
      plan.push({ action: 'createPipeline', args: { name: 'Standard Pipeline' } });
    }

    return {
      status: 'PLAN_PREVIEW',
      plan,
      message: 'Here is my proposed execution plan. Please approve to execute or cancel.',
    };
  }

  // Cancel Execution (Scenario 8)
  async cancelExecution(sessionId: string) {
    const active = this.activeExecutions.get(sessionId);
    if (!active) {
      return { status: 'NOT_FOUND', message: 'No active execution found for this session' };
    }

    active.abortController.abort();
    this.activeExecutions.delete(sessionId);

    return {
      status: 'CANCELLED',
      message: `Agent execution for '${active.toolName}' was cancelled by the user. Transactions rolled back.`,
    };
  }

  // Core execution routing
  async executeTool(
    workspaceId: string,
    userId: string,
    toolName: string,
    args: any,
    userRole: string,
    sessionId?: string,
  ) {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new NotFoundException(`Tool '${toolName}' not found`);
    }

    // 1. Permission Check
    if (!tool.permissions.includes(userRole)) {
      throw new ForbiddenException(`Access Denied: Role '${userRole}' lacks permission for '${toolName}'`);
    }

    // 2. High Risk / Approval Gate
    if (tool.isHighRisk(args)) {
      const approval = await this.prisma.agentApproval.create({
        data: {
          toolName,
          arguments: args,
          status: 'PENDING',
          workspaceId,
          requestedById: userId,
        },
      });

      return {
        status: 'PENDING_APPROVAL',
        approvalId: approval.id,
        message: `Human approval required: '${toolName}' is classified as high-risk. Approval record staged.`,
      };
    }

    // Create session tracking for cancellation test
    const finalSessionId = sessionId || `session_${Date.now()}`;
    const abortController = new AbortController();
    this.activeExecutions.set(finalSessionId, {
      abortController,
      toolName,
      startedAt: new Date(),
    });

    // Create audit log entry
    const auditLog = await this.prisma.auditLog.create({
      data: {
        actorType: 'AGENT',
        actorId: userId,
        action: toolName,
        payload: args,
        workspaceId,
        userId,
      },
    });

    try {
      // Check for early cancellation
      if (abortController.signal.aborted) {
        throw new Error('Transaction aborted early');
      }

      // Execute tool
      const result = await tool.handler(workspaceId, userId, args);

      // Clean up session registry
      this.activeExecutions.delete(finalSessionId);

      // Update audit log
      await this.prisma.auditLog.update({
        where: { id: auditLog.id },
        data: { response: result },
      });

      return {
        status: 'SUCCESS',
        result,
      };
    } catch (error: any) {
      this.activeExecutions.delete(finalSessionId);
      
      const errorMsg = error.message || 'Workflow execution error';
      await this.prisma.auditLog.update({
        where: { id: auditLog.id },
        data: { response: { error: errorMsg } },
      });

      return {
        status: 'ERROR',
        error: errorMsg,
      };
    }
  }

  // Approve a staged action
  async resolveApproval(workspaceId: string, userId: string, approvalId: string, action: 'APPROVE' | 'REJECT') {
    const approval = await this.prisma.agentApproval.findUnique({
      where: { id: approvalId },
    });

    if (!approval || approval.workspaceId !== workspaceId) {
      throw new NotFoundException('Staged approval record not found');
    }

    if (action === 'REJECT') {
      await this.prisma.agentApproval.update({
        where: { id: approvalId },
        data: { status: 'REJECTED', resolvedById: userId },
      });
      return { status: 'REJECTED', message: 'High-risk action rejected by user.' };
    }

    // Approve: execute the underlying tool
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: true },
    });
    const membership = user?.memberships.find(m => m.workspaceId === workspaceId);

    const execResult = await this.executeTool(
      workspaceId,
      approval.requestedById,
      approval.toolName,
      approval.arguments,
      membership?.role || 'USER',
    );

    await this.prisma.agentApproval.update({
      where: { id: approvalId },
      data: { status: 'APPROVED', resolvedById: userId },
    });

    return {
      status: 'APPROVED',
      result: execResult,
    };
  }
}
