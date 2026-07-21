"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma.service");
let DashboardService = class DashboardService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getDashboardData(workspaceId, user) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const leadsToday = await this.prisma.contact.count({
            where: {
                workspaceId,
                createdAt: { gte: startOfToday },
            },
        });
        const openOpps = await this.prisma.opportunity.findMany({
            where: {
                workspaceId,
                status: 'OPEN',
            },
        });
        let projectedRevenue = 0;
        let likelyToBookCount = 0;
        openOpps.forEach((opp) => {
            projectedRevenue += (opp.value * opp.probability) / 100;
            if (opp.probability >= 70) {
                likelyToBookCount++;
            }
        });
        const contactsNeedingFollowup = await this.prisma.contact.count({
            where: {
                workspaceId,
                status: 'LEAD',
                notes: { none: {} },
                activities: { none: {} },
            },
        });
        const hour = new Date().getHours();
        let greeting = 'Good day';
        if (hour < 12)
            greeting = 'Good morning';
        else if (hour < 18)
            greeting = 'Good afternoon';
        else
            greeting = 'Good evening';
        const userName = user.firstName || 'User';
        const brief = `${greeting}, ${userName}.
${leadsToday} new lead${leadsToday === 1 ? '' : 's'} entered today.
${likelyToBookCount} are highly likely to close.
${contactsNeedingFollowup} need immediate follow-up.
Revenue this month is projected at $${projectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.
No automations failed today.
How can I assist you with your pipelines?`;
        return {
            brief,
            stats: {
                leadsToday,
                likelyToBookCount,
                needsFollowup: contactsNeedingFollowup,
                projectedRevenue,
                openDealsCount: openOpps.length,
            },
        };
    }
};
exports.DashboardService = DashboardService;
exports.DashboardService = DashboardService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DashboardService);
//# sourceMappingURL=dashboard.service.js.map