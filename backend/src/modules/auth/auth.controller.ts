import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  RegisterDto,
  LoginDto,
  SelectWorkspaceDto,
  RefreshTokenDto,
  SwitchWorkspaceDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Public account/workspace creation. Stricter than the global 100/min
  // default -- this creates a new Organization + Workspace + User row per
  // call, so it's a more expensive and more abuse-prone target than a
  // normal read/write endpoint.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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
  async refresh(@Request() req: any, @Body() body: RefreshTokenDto) {
    // requestStartedAt is stamped by CorrelationIdMiddleware at the HTTP
    // boundary. It is what lets rotation tell a concurrent second tab apart
    // from a replay; see AuthService.isBenignConcurrentPresentation.
    return this.authService.refreshToken(
      body.refreshToken,
      req.requestStartedAt,
    );
  }

  /**
   * Moves the current session into another workspace without a password.
   *
   * Authenticated by the refresh token in the body rather than by
   * JwtAuthGuard, deliberately: the switch must SPEND the old session's token
   * so a user cannot accumulate one live token per workspace they visit, and
   * so eight concurrent switches produce one session rather than eight. The
   * access token proves identity but cannot be spent.
   */
  @Post('switch-workspace')
  async switchWorkspace(@Request() req: any, @Body() body: SwitchWorkspaceDto) {
    return this.authService.switchWorkspace(
      body.refreshToken,
      body.workspaceId,
      req.requestStartedAt,
    );
  }

  /**
   * The workspaces this caller may switch into.
   *
   * The user id comes from the verified JWT subject that JwtAuthGuard put on
   * the request -- there is no userId parameter to tamper with.
   */
  @UseGuards(JwtAuthGuard)
  @Get('memberships')
  async memberships(@Request() req: any) {
    return this.authService.listMemberships(req.user.id);
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
