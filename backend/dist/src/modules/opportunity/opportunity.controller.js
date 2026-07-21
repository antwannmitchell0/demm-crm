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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpportunityController = void 0;
const common_1 = require("@nestjs/common");
const opportunity_service_1 = require("./opportunity.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const workspace_guard_1 = require("../../common/guards/workspace.guard");
const current_workspace_decorator_1 = require("../../common/decorators/current-workspace.decorator");
let OpportunityController = class OpportunityController {
    opportunityService;
    constructor(opportunityService) {
        this.opportunityService = opportunityService;
    }
    async create(workspaceId, body) {
        return this.opportunityService.create(workspaceId, body);
    }
    async update(workspaceId, id, body) {
        return this.opportunityService.update(workspaceId, id, body);
    }
    async moveStage(workspaceId, id, stageId) {
        return this.opportunityService.moveStage(workspaceId, id, stageId);
    }
    async list(workspaceId) {
        return this.opportunityService.findAll(workspaceId);
    }
    async get(workspaceId, id) {
        return this.opportunityService.findById(workspaceId, id);
    }
};
exports.OpportunityController = OpportunityController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], OpportunityController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], OpportunityController.prototype, "update", null);
__decorate([
    (0, common_1.Put)(':id/move'),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('stageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], OpportunityController.prototype, "moveStage", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OpportunityController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], OpportunityController.prototype, "get", null);
exports.OpportunityController = OpportunityController = __decorate([
    (0, common_1.Controller)('opportunities'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, workspace_guard_1.WorkspaceGuard),
    __metadata("design:paramtypes", [opportunity_service_1.OpportunityService])
], OpportunityController);
//# sourceMappingURL=opportunity.controller.js.map