import { ContactService } from './contact.service';
export declare class ContactController {
    private contactService;
    constructor(contactService: ContactService);
    create(workspaceId: string, body: any): Promise<{
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
    update(workspaceId: string, id: string, body: any): Promise<{
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
    list(workspaceId: string): Promise<({
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
    get(workspaceId: string, id: string): Promise<{
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
}
