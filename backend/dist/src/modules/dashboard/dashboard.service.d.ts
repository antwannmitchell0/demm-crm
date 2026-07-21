import { PrismaService } from '../../prisma.service';
export declare class DashboardService {
    private prisma;
    constructor(prisma: PrismaService);
    getDashboardData(workspaceId: string, user: any): Promise<{
        brief: string;
        stats: {
            leadsToday: number;
            likelyToBookCount: number;
            needsFollowup: number;
            projectedRevenue: number;
            openDealsCount: number;
        };
    }>;
}
