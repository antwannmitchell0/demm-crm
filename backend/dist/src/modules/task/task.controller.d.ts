import { TaskService } from './task.service';
export declare class TaskController {
    private taskService;
    constructor(taskService: TaskService);
    create(workspaceId: string, body: any): Promise<{
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
    update(workspaceId: string, id: string, body: any): Promise<{
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
    list(workspaceId: string): Promise<{
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
    get(workspaceId: string, id: string): Promise<{
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
}
