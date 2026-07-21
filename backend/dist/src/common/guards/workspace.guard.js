"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceGuard = void 0;
const common_1 = require("@nestjs/common");
let WorkspaceGuard = class WorkspaceGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user) {
            throw new common_1.ForbiddenException('User session not found');
        }
        const headerWorkspaceId = request.headers['x-workspace-id'] || request.query['workspaceId'];
        const membership = user.memberships.find((m) => m.workspaceId === headerWorkspaceId || (!headerWorkspaceId && m.workspaceId));
        if (!membership) {
            throw new common_1.ForbiddenException('User is not a member of the requested workspace');
        }
        request.workspaceId = membership.workspaceId;
        request.user.role = membership.role;
        request.user.permissions = membership.permissions;
        return true;
    }
};
exports.WorkspaceGuard = WorkspaceGuard;
exports.WorkspaceGuard = WorkspaceGuard = __decorate([
    (0, common_1.Injectable)()
], WorkspaceGuard);
//# sourceMappingURL=workspace.guard.js.map