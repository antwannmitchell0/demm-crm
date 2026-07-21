import { CanActivate, ExecutionContext } from '@nestjs/common';
export declare class WorkspaceGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean;
}
