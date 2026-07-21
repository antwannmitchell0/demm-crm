import { PipelineService } from './pipeline.service';
export declare class PipelineController {
    private pipelineService;
    constructor(pipelineService: PipelineService);
    create(workspaceId: string, name: string): Promise<({
        stages: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        }[];
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
    }) | null>;
    list(workspaceId: string): Promise<({
        stages: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        }[];
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
    })[]>;
    get(workspaceId: string, id: string): Promise<{
        opportunities: ({
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
        })[];
        stages: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            pipelineId: string;
            order: number;
        }[];
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
    }>;
    addStage(workspaceId: string, pipelineId: string, name: string, order: number): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        pipelineId: string;
        order: number;
    }>;
}
