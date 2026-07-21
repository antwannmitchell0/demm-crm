import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { OpportunityStatus, ContactStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardData(workspaceId: string, user: any) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 1. Leads entered today
    const leadsToday = await this.prisma.contact.count({
      where: {
        workspaceId,
        createdAt: { gte: startOfToday },
      },
    });

    // 2. Open opportunities count
    const openOpps = await this.prisma.opportunity.findMany({
      where: {
        workspaceId,
        status: OpportunityStatus.OPEN,
      },
    });

    // 3. Projected revenue
    // projected = sum(value * probability / 100)
    let projectedRevenue = 0;
    let likelyToBookCount = 0;
    openOpps.forEach((opp) => {
      const numericVal = Number(opp.value);
      projectedRevenue += (numericVal * opp.probability) / 100;
      if (opp.probability >= 70) {
        likelyToBookCount++;
      }
    });

    // 4. Needs follow up
    // Simple heuristic: contacts marked LEAD with no notes or activities
    const contactsNeedingFollowup = await this.prisma.contact.count({
      where: {
        workspaceId,
        status: ContactStatus.LEAD,
        notes: { none: {} },
        activities: { none: {} },
      },
    });

    // 5. Build dynamic Executive Brief greeting
    const hour = new Date().getHours();
    let greeting = 'Good day';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 18) greeting = 'Good afternoon';
    else greeting = 'Good evening';

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
}
