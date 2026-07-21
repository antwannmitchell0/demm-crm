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
exports.AgentController = void 0;
const common_1 = require("@nestjs/common");
const agent_service_1 = require("./agent.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const workspace_guard_1 = require("../../common/guards/workspace.guard");
const current_workspace_decorator_1 = require("../../common/decorators/current-workspace.decorator");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
let AgentController = class AgentController {
    agentService;
    constructor(agentService) {
        this.agentService = agentService;
    }
    async listTools() {
        return this.agentService.getRegisteredTools();
    }
    async execute(workspaceId, user, toolName, args, sessionId) {
        return this.agentService.executeTool(workspaceId, user.id, toolName, args, user.role, sessionId);
    }
    async previewPlan(workspaceId, user, description) {
        return this.agentService.previewPlan(workspaceId, user.id, description);
    }
    async cancel(sessionId) {
        return this.agentService.cancelExecution(sessionId);
    }
    async resolveApproval(workspaceId, user, id, action) {
        return this.agentService.resolveApproval(workspaceId, user.id, id, action);
    }
};
exports.AgentController = AgentController;
__decorate([
    (0, common_1.Get)('tools'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "listTools", null);
__decorate([
    (0, common_1.Post)('execute'),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)('toolName')),
    __param(3, (0, common_1.Body)('arguments')),
    __param(4, (0, common_1.Body)('sessionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, Object, String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "execute", null);
__decorate([
    (0, common_1.Post)('plan/preview'),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)('description')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "previewPlan", null);
__decorate([
    (0, common_1.Post)('execute/cancel'),
    __param(0, (0, common_1.Body)('sessionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)('approvals/:id/resolve'),
    __param(0, (0, current_workspace_decorator_1.CurrentWorkspaceId)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Param)('id')),
    __param(3, (0, common_1.Body)('action')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, String]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "resolveApproval", null);
exports.AgentController = AgentController = __decorate([
    (0, common_1.Controller)('agent'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, workspace_guard_1.WorkspaceGuard),
    __metadata("design:paramtypes", [agent_service_1.AgentService])
], AgentController);
//# sourceMappingURL=agent.controller.js.map