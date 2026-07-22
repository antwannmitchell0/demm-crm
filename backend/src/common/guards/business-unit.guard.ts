import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class BusinessUnitGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const workspaceId = request.workspaceId; // Set by WorkspaceGuard

    if (!workspaceId) {
      throw new ForbiddenException(
        'Business unit scope requires an active workspace',
      );
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { businessUnitId: true, organizationId: true },
    });

    if (!workspace?.businessUnitId) {
      // Deny by default: DOM26-R access requires the workspace to be
      // assigned to a Business Unit. Cross-business access is never implied.
      throw new ForbiddenException(
        'Workspace is not assigned to a Business Unit',
      );
    }

    request.businessUnitId = workspace.businessUnitId;
    request.organizationId = workspace.organizationId;

    return true;
  }
}
