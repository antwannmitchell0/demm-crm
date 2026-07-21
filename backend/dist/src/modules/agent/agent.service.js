"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma.service");
const contact_service_1 = require("../contact/contact.service");
const pipeline_service_1 = require("../pipeline/pipeline.service");
const opportunity_service_1 = require("../opportunity/opportunity.service");
const dashboard_service_1 = require("../dashboard/dashboard.service");
let AgentService = class AgentService {
    prisma;
    contactService;
    pipelineService;
    opportunityService;
    dashboardService;
    toolRegistry = new Map();
    activeExecutions = new Map();
    constructor(prisma, contactService, pipelineService, opportunityService, dashboardService) {
        this.prisma = prisma;
        this.contactService = contactService;
        this.pipelineService = pipelineService;
        this.opportunityService = opportunityService;
        this.dashboardService = dashboardService;
        this.registerTools();
    }
    registerTools() {
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
    async previewPlan(workspaceId, userId, description) {
        const plan = [];
        if (description.toLowerCase().includes('wedding')) {
            plan.push({ action: 'createPipeline', args: { name: 'Wedding Lead Pipeline' } });
            plan.push({ action: 'createContact', args: { firstName: 'Sarah', lastName: 'Wedding-Lead', emails: ['sarah@wed.com'] } });
        }
        else {
            plan.push({ action: 'createPipeline', args: { name: 'Standard Pipeline' } });
        }
        return {
            status: 'PLAN_PREVIEW',
            plan,
            message: 'Here is my proposed execution plan. Please approve to execute or cancel.',
        };
    }
    async cancelExecution(sessionId) {
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
    async executeTool(workspaceId, userId, toolName, args, userRole, sessionId) {
        const tool = this.toolRegistry.get(toolName);
        if (!tool) {
            throw new common_1.NotFoundException(`Tool '${toolName}' not found`);
        }
        if (!tool.permissions.includes(userRole)) {
            throw new common_1.ForbiddenException(`Access Denied: Role '${userRole}' lacks permission for '${toolName}'`);
        }
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
        const finalSessionId = sessionId || `session_${Date.now()}`;
        const abortController = new AbortController();
        this.activeExecutions.set(finalSessionId, {
            abortController,
            toolName,
            startedAt: new Date(),
        });
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
            if (abortController.signal.aborted) {
                throw new Error('Transaction aborted early');
            }
            const result = await tool.handler(workspaceId, userId, args);
            this.activeExecutions.delete(finalSessionId);
            await this.prisma.auditLog.update({
                where: { id: auditLog.id },
                data: { response: result },
            });
            return {
                status: 'SUCCESS',
                result,
            };
        }
        catch (error) {
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
    async resolveApproval(workspaceId, userId, approvalId, action) {
        const approval = await this.prisma.agentApproval.findUnique({
            where: { id: approvalId },
        });
        if (!approval || approval.workspaceId !== workspaceId) {
            throw new common_1.NotFoundException('Staged approval record not found');
        }
        if (action === 'REJECT') {
            await this.prisma.agentApproval.update({
                where: { id: approvalId },
                data: { status: 'REJECTED', resolvedById: userId },
            });
            return { status: 'REJECTED', message: 'High-risk action rejected by user.' };
        }
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { memberships: true },
        });
        const membership = user?.memberships.find(m => m.workspaceId === workspaceId);
        const execResult = await this.executeTool(workspaceId, approval.requestedById, approval.toolName, approval.arguments, membership?.role || 'USER');
        await this.prisma.agentApproval.update({
            where: { id: approvalId },
            data: { status: 'APPROVED', resolvedById: userId },
        });
        return {
            status: 'APPROVED',
            result: execResult,
        };
    }
};
exports.AgentService = AgentService;
exports.AgentService = AgentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        contact_service_1.ContactService,
        pipeline_service_1.PipelineService,
        opportunity_service_1.OpportunityService,
        dashboard_service_1.DashboardService])
], AgentService);
//# sourceMappingURL=agent.service.js.map