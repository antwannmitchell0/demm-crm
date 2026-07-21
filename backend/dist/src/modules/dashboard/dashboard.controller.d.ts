import { DashboardService } from './dashboard.service';
export declare class DashboardController {
    private dashboardService;
    constructor(dashboardService: DashboardService);
    getDashboard(workspaceId: string, user: any): Promise<{
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
