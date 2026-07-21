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
exports.TaskService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma.service");
let TaskService = class TaskService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(workspaceId, data) {
        return this.prisma.task.create({
            data: {
                ...data,
                workspaceId,
            },
        });
    }
    async update(workspaceId, id, data) {
        const task = await this.prisma.task.findFirst({
            where: { id, workspaceId },
        });
        if (!task) {
            throw new common_1.NotFoundException('Task not found');
        }
        return this.prisma.task.update({
            where: { id },
            data,
        });
    }
    async findById(workspaceId, id) {
        const task = await this.prisma.task.findFirst({
            where: { id, workspaceId },
        });
        if (!task) {
            throw new common_1.NotFoundException('Task not found');
        }
        return task;
    }
    async findAll(workspaceId) {
        return this.prisma.task.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
        });
    }
};
exports.TaskService = TaskService;
exports.TaskService = TaskService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TaskService);
//# sourceMappingURL=task.service.js.map