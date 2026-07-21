import { AuthService } from './auth.service';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    register(body: {
        email: string;
        passwordPlain: string;
        firstName: string;
        lastName: string;
        workspaceName: string;
        subdomain: string;
    }): Promise<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        workspaceId: string;
        organizationId: string;
    }>;
    login(body: {
        email: string;
        passwordPlain: string;
    }): Promise<{
        access_token: string;
        user: {
            id: string;
            email: string;
            firstName: string;
            lastName: string;
            role: import("@prisma/client").$Enums.Role;
            workspaceId: string | null;
        };
    }>;
    me(user: any): Promise<any>;
}
