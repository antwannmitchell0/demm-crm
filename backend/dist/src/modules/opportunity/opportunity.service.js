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
exports.OpportunityService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma.service");
let OpportunityService = class OpportunityService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(workspaceId, data) {
        return this.prisma.opportunity.create({
            data: {
                ...data,
                workspaceId,
            },
            include: {
                pipeline: true,
                stage: true,
                contact: true,
                owner: true,
            },
        });
    }
    async update(workspaceId, id, data) {
        const opp = await this.prisma.opportunity.findFirst({
            where: { id, workspaceId },
        });
        if (!opp) {
            throw new common_1.NotFoundException('Opportunity not found in workspace');
        }
        return this.prisma.opportunity.update({
            where: { id },
            data,
            include: {
                pipeline: true,
                stage: true,
                contact: true,
                owner: true,
            },
        });
    }
    async moveStage(workspaceId, id, stageId) {
        const opp = await this.prisma.opportunity.findFirst({
            where: { id, workspaceId },
        });
        if (!opp) {
            throw new common_1.NotFoundException('Opportunity not found');
        }
        const stage = await this.prisma.stage.findFirst({
            where: { id: stageId, pipeline: { workspaceId } },
        });
        if (!stage) {
            throw new common_1.NotFoundException('Target stage not found in this workspace');
        }
        const updatedOpp = await this.prisma.opportunity.update({
            where: { id },
            data: { stageId },
            include: { stage: true },
        });
        await this.prisma.activity.create({
            data: {
                type: 'SYSTEM_EVENT',
                description: `Moved deal to stage: ${updatedOpp.stage.name}`,
                opportunityId: id,
            },
        });
        return updatedOpp;
    }
    async findById(workspaceId, id) {
        const opp = await this.prisma.opportunity.findFirst({
            where: { id, workspaceId },
            include: {
                pipeline: true,
                stage: true,
                contact: true,
                owner: true,
                notes: { orderBy: { createdAt: 'desc' } },
                activities: { orderBy: { createdAt: 'desc' } },
            },
        });
        if (!opp) {
            throw new common_1.NotFoundException('Opportunity not found');
        }
        return opp;
    }
    async findAll(workspaceId) {
        return this.prisma.opportunity.findMany({
            where: { workspaceId },
            include: {
                pipeline: true,
                stage: true,
                contact: true,
                owner: true,
            },
            orderBy: { updatedAt: 'desc' },
        });
    }
};
exports.OpportunityService = OpportunityService;
exports.OpportunityService = OpportunityService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], OpportunityService);
//# sourceMappingURL=opportunity.service.js.map