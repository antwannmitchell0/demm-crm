import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  RegisterDto,
  LoginDto,
  SelectWorkspaceDto,
  RefreshTokenDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('select-workspace')
  async selectWorkspace(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: SelectWorkspaceDto,
  ) {
    const preAuthToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    if (!preAuthToken) {
      throw new UnauthorizedException(
        'Missing pre-auth token from Authorization header',
      );
    }
    return this.authService.selectWorkspace(preAuthToken, body.workspaceId);
  }

  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Post('logout')
  async logout(@Body() body: RefreshTokenDto) {
    return this.authService.logout(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Request() req: any) {
    // req.user is the Prisma User record (see jwt.strategy.ts) -- its
    // primary key field is `id`, not `userId`. Reading `.userId` here
    // was always undefined, and Prisma treats an undefined filter value
    // as "omit this condition" -- so this call was revoking every
    // refresh token for every user in the system, not just the caller's.
    return this.authService.logoutAll(req.user.id);
  }
}
