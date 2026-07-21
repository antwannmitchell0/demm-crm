import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ContactService } from '../contact/contact.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { OpportunityService } from '../opportunity/opportunity.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { redactAuditPayload } from '../../common/utils/audit-redactor';
import { ApprovalStatus } from '@prisma/client';

@Injectable()
export class AgentService {
  private toolRegistry = new Map<string, {
    description: string;
    permissions: string[];
    isHighRisk: (args: any) => boolean;
    handler: (workspaceId: string, userId: string, args: any) => Promise<any>;
  }>();

  private activeExecutions = new Map<string, {
    abortController: AbortController;
    toolName: string;
    startedAt: Date;
  }>();

  private completedExecutions = new Set<string>();

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
    this.toolRegistry.set('getDashboard', {
      description: 'Retrieve the daily executive brief and key performance indicators.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN', 'USER'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId) => {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        return this.dashboardService.getDashboardData(workspaceId, user);
      },
    });

    this.toolRegistry.set('createContact', {
      description: 'Create a new contact record.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.contactService.create(workspaceId, args);
      },
    });

    this.toolRegistry.set('searchContacts', {
      description: 'Search contacts by name, email, phone, or tags.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN', 'USER'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.contactService.search(workspaceId, args.query || '');
      },
    });

    this.toolRegistry.set('createPipeline', {
      description: 'Create a new deal pipeline.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.pipelineService.create(workspaceId, args.name);
      },
    });

    this.toolRegistry.set('createOpportunity', {
      description: 'Create a new deal opportunity.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      isHighRisk: (args) => (args.value || 0) > 5000,
      handler: async (workspaceId, userId, args) => {
        return this.opportunityService.create(workspaceId, args);
      },
    });

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

  async previewPlan(workspaceId: string, userId: string, description: string) {
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
      message: 'Proposed execution plan compiled. Approve to execute or cancel.',
    };
  }

  async cancelExecution(sessionId: string) {
    const active = this.activeExecutions.get(sessionId);
    if (!active) {
      if (this.completedExecutions.has(sessionId)) {
        return {
          status: 'NOT_FOUND',
          message: 'Best-effort pre-commit cancellation: pre-commit already resolved.',
        };
      }
      const abortController = new AbortController();
      abortController.abort();
      this.activeExecutions.set(sessionId, {
        abortController,
        toolName: 'pre-emptive-abort',
        startedAt: new Date(),
      });
      return {
        status: 'CANCELLED',
        message: 'Best-effort pre-commit cancellation: pre-emptive abort applied.',
      };
    }

    active.abortController.abort();
    this.activeExecutions.delete(sessionId);
    this.completedExecutions.add(sessionId);

    return {
      status: 'CANCELLED',
      message: `Best-effort pre-commit cancellation: Active run for '${active.toolName}' cancelled.`,
    };
  }

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

    if (!tool.permissions.includes(userRole)) {
      throw new ForbiddenException(`Access Denied: Role '${userRole}' lacks permission for '${toolName}'`);
    }

    // Scrub sensitive parameters in arguments before staging audit log
    const sanitizedArgs = redactAuditPayload(args);

    if (tool.isHighRisk(args)) {
      const approval = await this.prisma.agentApproval.create({
        data: {
          toolName,
          arguments: sanitizedArgs,
          status: ApprovalStatus.PENDING,
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

    const finalSessionId = sessionId || `session_${Date.now()}`;
    let abortController = new AbortController();
    
    const preExisting = this.activeExecutions.get(finalSessionId);
    if (preExisting) {
      abortController = preExisting.abortController;
    } else {
      this.activeExecutions.set(finalSessionId, {
        abortController,
        toolName,
        startedAt: new Date(),
      });
    }

    // Redact payload before writing AuditLog
    const auditLog = await this.prisma.auditLog.create({
      data: {
        actorType: 'AGENT',
        actorId: userId,
        action: toolName,
        payload: sanitizedArgs,
        workspaceId,
        userId,
      },
    });

    try {
      if (abortController.signal.aborted) {
        throw new Error('Transaction aborted early via best-effort pre-commit cancellation.');
      }

      const result = await tool.handler(workspaceId, userId, args);

      this.activeExecutions.delete(finalSessionId);
      this.completedExecutions.add(finalSessionId);

      const sanitizedResult = redactAuditPayload(result);

      await this.prisma.auditLog.update({
        where: { id: auditLog.id },
        data: { response: sanitizedResult },
      });

      return {
        status: 'SUCCESS',
        result,
      };
    } catch (error: any) {
      this.activeExecutions.delete(finalSessionId);
      this.completedExecutions.add(finalSessionId);
      
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
        data: { status: ApprovalStatus.REJECTED, resolvedById: userId },
      });
      return { status: 'REJECTED', message: 'High-risk action rejected by user.' };
    }

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
      data: { status: ApprovalStatus.APPROVED, resolvedById: userId },
    });

    return {
      status: 'APPROVED',
      result: execResult,
    };
  }
}
