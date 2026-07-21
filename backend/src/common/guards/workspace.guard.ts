import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Added by JwtAuthGuard

    if (!user) {
      throw new ForbiddenException('User session not found');
    }

    // Resolve target workspace ID from request
    const headerWorkspaceId =
      request.headers['x-workspace-id'] || request.query['workspaceId'];

    // Find user's membership for the resolved workspace
    const membership = user.memberships.find(
      (m: any) =>
        m.workspaceId === headerWorkspaceId ||
        (!headerWorkspaceId && m.workspaceId),
    );

    if (!membership) {
      throw new ForbiddenException(
        'User is not a member of the requested workspace',
      );
    }

    // Enforce active workspace context on request
    request.workspaceId = membership.workspaceId;
    // Map membership role to request user for roles authorization
    request.user.role = membership.role;
    request.user.permissions = membership.permissions;

    return true;
  }
}
