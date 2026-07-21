import { PrismaService } from '../../prisma.service';
export declare class WorkspaceService {
    private prisma;
    constructor(prisma: PrismaService);
    create(name: string, subdomain: string, organizationId: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        subdomain: string;
        organizationId: string;
    }>;
    findById(id: string): Promise<({
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
    findAll(): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        subdomain: string;
        organizationId: string;
    }[]>;
}
