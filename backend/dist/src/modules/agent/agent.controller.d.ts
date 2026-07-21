import { AgentService } from './agent.service';
export declare class AgentController {
    private agentService;
    constructor(agentService: AgentService);
    listTools(): Promise<{
        name: string;
        description: string;
        permissions: string[];
    }[]>;
    execute(workspaceId: string, user: any, toolName: string, args: any, sessionId?: string): Promise<{
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
    previewPlan(workspaceId: string, user: any, description: string): Promise<{
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
    cancel(sessionId: string): Promise<{
        status: string;
        message: string;
    }>;
    resolveApproval(workspaceId: string, user: any, id: string, action: 'APPROVE' | 'REJECT'): Promise<{
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
