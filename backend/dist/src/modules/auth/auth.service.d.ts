import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service';
export declare class AuthService {
    private prisma;
    private jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    register(data: {
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
    login(email: string, passwordPlain: string): Promise<{
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
}
