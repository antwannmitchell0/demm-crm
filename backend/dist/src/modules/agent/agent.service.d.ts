import { PrismaService } from '../../prisma.service';
import { ContactService } from '../contact/contact.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { OpportunityService } from '../opportunity/opportunity.service';
import { DashboardService } from '../dashboard/dashboard.service';
export declare class AgentService {
    private prisma;
    private contactService;
    private pipelineService;
    private opportunityService;
    private dashboardService;
    private toolRegistry;
    private activeExecutions;
    private completedExecutions;
    constructor(prisma: PrismaService, contactService: ContactService, pipelineService: PipelineService, opportunityService: OpportunityService, dashboardService: DashboardService);
    private registerTools;
    getRegisteredTools(): {
        name: string;
        description: string;
        permissions: string[];
    }[];
    previewPlan(workspaceId: string, userId: string, description: string): Promise<{
        status: string;
        plan: ({
            action: string;
            args: {
                name: string;
                firstName?: undefined;
                lastName?: undefined;
                emails?: undefined;
            };
        } | {
            action: string;
            args: {
                firstName: string;
                lastName: string;
                emails: string[];
                name?: undefined;
            };
        })[];
        message: string;
    }>;
    cancelExecution(sessionId: string): Promise<{
        status: string;
        message: string;
    }>;
    executeTool(workspaceId: string, userId: string, toolName: string, args: any, userRole: string, sessionId?: string): Promise<{
        status: string;
        approvalId: string;
        message: string;
        result?: undefined;
        error?: undefined;
    } | {
        status: string;
        result: any;
        approvalId?: undefined;
        message?: undefined;
        error?: undefined;
    } | {
        status: string;
        error: any;
        approvalId?: undefined;
        message?: undefined;
        result?: undefined;
    }>;
    resolveApproval(workspaceId: string, userId: string, approvalId: string, action: 'APPROVE' | 'REJECT'): Promise<{
        status: string;
        message: string;
        result?: undefined;
    } | {
        status: string;
        result: {
            status: string;
            approvalId: string;
            message: string;
            result?: undefined;
            error?: undefined;
        } | {
            status: string;
            result: any;
            approvalId?: undefined;
            message?: undefined;
            error?: undefined;
        } | {
            status: string;
            error: any;
            approvalId?: undefined;
            message?: undefined;
            result?: undefined;
        };
        message?: undefined;
    }>;
}
