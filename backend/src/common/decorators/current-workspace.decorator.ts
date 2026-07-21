import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentWorkspaceId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.workspaceId;
  },
);
