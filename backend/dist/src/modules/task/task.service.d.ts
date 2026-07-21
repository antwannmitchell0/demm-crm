import { PrismaService } from '../../prisma.service';
export declare class TaskService {
    private prisma;
    constructor(prisma: PrismaService);
    create(workspaceId: string, data: {
        title: string;
        description?: string;
        dueDate?: Date;
        contactId?: string;
        opportunityId?: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        contactId: string | null;
        opportunityId: string | null;
        description: string | null;
        title: string;
        dueDate: Date | null;
    }>;
    update(workspaceId: string, id: string, data: {
        title?: string;
        description?: string;
        status?: string;
        dueDate?: Date;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        contactId: string | null;
        opportunityId: string | null;
        description: string | null;
        title: string;
        dueDate: Date | null;
    }>;
    findById(workspaceId: string, id: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        contactId: string | null;
        opportunityId: string | null;
        description: string | null;
        title: string;
        dueDate: Date | null;
    }>;
    findAll(workspaceId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        workspaceId: string;
        status: string;
        contactId: string | null;
        opportunityId: string | null;
        description: string | null;
        title: string;
        dueDate: Date | null;
    }[]>;
}
