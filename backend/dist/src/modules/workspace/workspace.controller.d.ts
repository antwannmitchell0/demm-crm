import { WorkspaceService } from './workspace.service';
export declare class WorkspaceController {
    private workspaceService;
    constructor(workspaceService: WorkspaceService);
    create(name: string, subdomain: string, organizationId: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        subdomain: string;
        organizationId: string;
    }>;
    list(): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        subdomain: string;
        organizationId: string;
    }[]>;
    get(id: string): Promise<({
        pipelines: ({
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
        })[];
    } & {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        subdomain: string;
        organizationId: string;
    }) | null>;
}
