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
exports.PipelineService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma.service");
let PipelineService = class PipelineService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(workspaceId, name) {
        return this.prisma.$transaction(async (tx) => {
            const pipeline = await tx.pipeline.create({
                data: { name, workspaceId },
            });
            const defaultStages = [
                { name: 'Lead', order: 1 },
                { name: 'Qualified', order: 2 },
                { name: 'Negotiation', order: 3 },
                { name: 'Won', order: 4 },
                { name: 'Lost', order: 5 },
            ];
            await Promise.all(defaultStages.map((stage) => tx.stage.create({
                data: {
                    name: stage.name,
                    order: stage.order,
                    pipelineId: pipeline.id,
                },
            })));
            return tx.pipeline.findUnique({
                where: { id: pipeline.id },
                include: { stages: { orderBy: { order: 'asc' } } },
            });
        });
    }
    async findById(workspaceId, id) {
        const pipeline = await this.prisma.pipeline.findFirst({
            where: { id, workspaceId },
            include: {
                stages: { orderBy: { order: 'asc' } },
                opportunities: { include: { stage: true, contact: true } },
            },
        });
        if (!pipeline) {
            throw new common_1.NotFoundException('Pipeline not found');
        }
        return pipeline;
    }
    async findAll(workspaceId) {
        return this.prisma.pipeline.findMany({
            where: { workspaceId },
            include: { stages: { orderBy: { order: 'asc' } } },
            orderBy: { createdAt: 'desc' },
        });
    }
    async addStage(workspaceId, pipelineId, name, order) {
        const pipeline = await this.prisma.pipeline.findFirst({
            where: { id: pipelineId, workspaceId },
        });
        if (!pipeline) {
            throw new common_1.NotFoundException('Pipeline not found');
        }
        return this.prisma.stage.create({
            data: {
                name,
                order,
                pipelineId,
            },
        });
    }
};
exports.PipelineService = PipelineService;
exports.PipelineService = PipelineService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PipelineService);
//# sourceMappingURL=pipeline.service.js.map