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
exports.ContactService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma.service");
let ContactService = class ContactService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(workspaceId, data) {
        return this.prisma.contact.create({
            data: {
                ...data,
                workspaceId,
                emails: data.emails || [],
                phones: data.phones || [],
                tags: data.tags || [],
            },
            include: {
                company: true,
                owner: true,
            },
        });
    }
    async update(workspaceId, id, data) {
        const contact = await this.prisma.contact.findFirst({
            where: { id, workspaceId },
        });
        if (!contact) {
            throw new common_1.NotFoundException('Contact not found in this workspace');
        }
        return this.prisma.contact.update({
            where: { id },
            data,
            include: {
                company: true,
                owner: true,
            },
        });
    }
    async findById(workspaceId, id) {
        const contact = await this.prisma.contact.findFirst({
            where: { id, workspaceId },
            include: {
                company: true,
                owner: true,
                notes: { orderBy: { createdAt: 'desc' } },
                activities: { orderBy: { createdAt: 'desc' } },
                opportunities: true,
            },
        });
        if (!contact) {
            throw new common_1.NotFoundException('Contact not found');
        }
        return contact;
    }
    async findAll(workspaceId) {
        return this.prisma.contact.findMany({
            where: { workspaceId },
            include: {
                company: true,
                owner: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async search(workspaceId, query) {
        return this.prisma.contact.findMany({
            where: {
                workspaceId,
                OR: [
                    { firstName: { contains: query, mode: 'insensitive' } },
                    { lastName: { contains: query, mode: 'insensitive' } },
                    { emails: { has: query } },
                    { phones: { has: query } },
                    { tags: { has: query } },
                ],
            },
            include: {
                company: true,
                owner: true,
            },
        });
    }
};
exports.ContactService = ContactService;
exports.ContactService = ContactService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ContactService);
//# sourceMappingURL=contact.service.js.map