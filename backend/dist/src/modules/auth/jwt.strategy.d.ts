import { Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma.service';
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private prisma;
    constructor(prisma: PrismaService);
    validate(payload: {
        sub: string;
        email: string;
        workspaceId: string;
    }): Promise<{
        memberships: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            organizationId: string;
            role: import("@prisma/client").$Enums.Role;
            permissions: string[];
            userId: string;
            workspaceId: string | null;
        }[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        passwordHash: string;
        firstName: string;
        lastName: string;
    }>;
}
export {};
