import { CompanyService } from './company.service';
export declare class CompanyController {
    private companyService;
    constructor(companyService: CompanyService);
    create(workspaceId: string, body: any): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        domain: string | null;
        industry: string | null;
    }>;
    update(workspaceId: string, id: string, body: any): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        domain: string | null;
        industry: string | null;
    }>;
    list(workspaceId: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        domain: string | null;
        industry: string | null;
    }[]>;
    get(workspaceId: string, id: string): Promise<{
        contacts: {
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
        }[];
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        domain: string | null;
        industry: string | null;
    }>;
}
