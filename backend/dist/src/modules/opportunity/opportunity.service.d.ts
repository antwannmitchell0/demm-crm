import { PrismaService } from '../../prisma.service';
export declare class OpportunityService {
    private prisma;
    constructor(prisma: PrismaService);
    create(workspaceId: string, data: {
        name: string;
        value?: number;
        probability?: number;
        expectedClose?: Date;
        pipelineId: string;
        stageId: string;
        contactId?: string;
        ownerId?: string;
    }): Promise<{
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
    update(workspaceId: string, id: string, data: {
        name?: string;
        value?: number;
        probability?: number;
        expectedClose?: Date;
        status?: string;
        stageId?: string;
        contactId?: string;
        ownerId?: string;
        aiInsights?: string;
    }): Promise<{
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
    findById(workspaceId: string, id: string): Promise<{
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
    findAll(workspaceId: string): Promise<({
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
}
