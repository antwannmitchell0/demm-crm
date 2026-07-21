import { OpportunityService } from './opportunity.service';
export declare class OpportunityController {
    private opportunityService;
    constructor(opportunityService: OpportunityService);
    create(workspaceId: string, body: any): Promise<{
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
        contact: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            workspaceId: string;
            emails: string[];
            phones: string[];
            address: import("@prisma/client/runtime/client").JsonValue | null;
            tags: string[];
            status: string;
            source: string | null;
            leadScore: number;
            customFields: import("@prisma/client/runtime/client").JsonValue | null;
            aiSummary: string | null;
            aiRecommends: import("@prisma/client/runtime/client").JsonValue | null;
            companyId: string | null;
            ownerId: string | null;
        } | null;
        pipeline: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
        };
        stage: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        };
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        ownerId: string | null;
        value: number;
        probability: number;
        expectedClose: Date | null;
        pipelineId: string;
        stageId: string;
        contactId: string | null;
        aiInsights: string | null;
    }>;
    update(workspaceId: string, id: string, body: any): Promise<{
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
        contact: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            workspaceId: string;
            emails: string[];
            phones: string[];
            address: import("@prisma/client/runtime/client").JsonValue | null;
            tags: string[];
            status: string;
            source: string | null;
            leadScore: number;
            customFields: import("@prisma/client/runtime/client").JsonValue | null;
            aiSummary: string | null;
            aiRecommends: import("@prisma/client/runtime/client").JsonValue | null;
            companyId: string | null;
            ownerId: string | null;
        } | null;
        pipeline: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
        };
        stage: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        };
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        ownerId: string | null;
        value: number;
        probability: number;
        expectedClose: Date | null;
        pipelineId: string;
        stageId: string;
        contactId: string | null;
        aiInsights: string | null;
    }>;
    moveStage(workspaceId: string, id: string, stageId: string): Promise<{
        stage: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        };
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        ownerId: string | null;
        value: number;
        probability: number;
        expectedClose: Date | null;
        pipelineId: string;
        stageId: string;
        contactId: string | null;
        aiInsights: string | null;
    }>;
    list(workspaceId: string): Promise<({
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
        contact: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            workspaceId: string;
            emails: string[];
            phones: string[];
            address: import("@prisma/client/runtime/client").JsonValue | null;
            tags: string[];
            status: string;
            source: string | null;
            leadScore: number;
            customFields: import("@prisma/client/runtime/client").JsonValue | null;
            aiSummary: string | null;
            aiRecommends: import("@prisma/client/runtime/client").JsonValue | null;
            companyId: string | null;
            ownerId: string | null;
        } | null;
        pipeline: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
        };
        stage: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        };
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        ownerId: string | null;
        value: number;
        probability: number;
        expectedClose: Date | null;
        pipelineId: string;
        stageId: string;
        contactId: string | null;
        aiInsights: string | null;
    })[]>;
    get(workspaceId: string, id: string): Promise<{
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
        notes: {
            id: string;
            createdAt: Date;
            contactId: string | null;
            content: string;
            opportunityId: string | null;
        }[];
        activities: {
            id: string;
            createdAt: Date;
            contactId: string | null;
            opportunityId: string | null;
            type: string;
            description: string;
        }[];
        contact: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            workspaceId: string;
            emails: string[];
            phones: string[];
            address: import("@prisma/client/runtime/client").JsonValue | null;
            tags: string[];
            status: string;
            source: string | null;
            leadScore: number;
            customFields: import("@prisma/client/runtime/client").JsonValue | null;
            aiSummary: string | null;
            aiRecommends: import("@prisma/client/runtime/client").JsonValue | null;
            companyId: string | null;
            ownerId: string | null;
        } | null;
        pipeline: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
        };
        stage: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        };
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        ownerId: string | null;
        value: number;
        probability: number;
        expectedClose: Date | null;
        pipelineId: string;
        stageId: string;
        contactId: string | null;
        aiInsights: string | null;
    }>;
}
