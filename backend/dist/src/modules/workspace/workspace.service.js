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
exports.WorkspaceService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma.service");
let WorkspaceService = class WorkspaceService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(name, subdomain, organizationId) {
        const existing = await this.prisma.workspace.findUnique({
            where: { subdomain },
        });
        if (existing) {
            throw new common_1.ConflictException('Subdomain already in use');
        }
        return this.prisma.$transaction(async (tx) => {
            const workspace = await tx.workspace.create({
                data: { name, subdomain, organizationId },
            });
            const pipeline = await tx.pipeline.create({
                data: {
                    name: 'General Sales',
                    workspaceId: workspace.id,
                },
            });
            const defaultStages = [
                { name: 'Lead In', order: 1 },
                { name: 'Contacted', order: 2 },
                { name: 'Meeting Scheduled', order: 3 },
                { name: 'Proposal Sent', order: 4 },
                { name: 'Won', order: 5 },
                { name: 'Lost', order: 6 },
            ];
            await Promise.all(defaultStages.map((stage) => tx.stage.create({
                data: {
                    name: stage.name,
                    order: stage.order,
                    pipelineId: pipeline.id,
                },
            })));
            return workspace;
        });
    }
    async findById(id) {
        return this.prisma.workspace.findUnique({
            where: { id },
            include: {
                pipelines: {
                    include: { stages: { orderBy: { order: 'asc' } } },
                },
            },
        });
    }
    async findAll() {
        return this.prisma.workspace.findMany();
    }
};
exports.WorkspaceService = WorkspaceService;
exports.WorkspaceService = WorkspaceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WorkspaceService);
//# sourceMappingURL=workspace.service.js.map