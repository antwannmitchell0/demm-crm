import { PrismaService } from '../../prisma.service';
export declare class ContactService {
    private prisma;
    constructor(prisma: PrismaService);
    create(workspaceId: string, data: {
        firstName: string;
        lastName: string;
        emails?: string[];
        phones?: string[];
        address?: any;
        tags?: string[];
        status?: string;
        source?: string;
        leadScore?: number;
        customFields?: any;
        companyId?: string;
        ownerId?: string;
    }): Promise<{
        company: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
            domain: string | null;
            industry: string | null;
        } | null;
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
    } & {
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
    }>;
    update(workspaceId: string, id: string, data: {
        firstName?: string;
        lastName?: string;
        emails?: string[];
        phones?: string[];
        address?: any;
        tags?: string[];
        status?: string;
        source?: string;
        leadScore?: number;
        customFields?: any;
        aiSummary?: string;
        aiRecommends?: any;
        companyId?: string;
        ownerId?: string;
    }): Promise<{
        company: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
            domain: string | null;
            industry: string | null;
        } | null;
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
    } & {
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
    }>;
    findById(workspaceId: string, id: string): Promise<{
        opportunities: {
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
        }[];
        company: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
            domain: string | null;
            industry: string | null;
        } | null;
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
    } & {
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
    }>;
    findAll(workspaceId: string): Promise<({
        company: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
            domain: string | null;
            industry: string | null;
        } | null;
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
    } & {
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
    })[]>;
    search(workspaceId: string, query: string): Promise<({
        company: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            workspaceId: string;
            domain: string | null;
            industry: string | null;
        } | null;
        owner: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            passwordHash: string;
            firstName: string;
            lastName: string;
        } | null;
    } & {
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
    })[]>;
}
