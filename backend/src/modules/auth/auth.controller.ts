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
  MintInvitationCapabilityDto,
  RegisterInvitedDto,
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

  // Deliberately looser than register()'s 5/min, and the difference is the
  // point.
  //
  // register() creates an Organization, a Workspace and a Membership: it is
  // expensive, not idempotent, and nobody legitimately calls it twice. This
  // endpoint is the opposite -- the product's entire recovery story for a lost
  // response, a double-click, or a failed acceptance is "press the button
  // again", and a repeat with the correct password writes nothing at all.
  // Measured at 5/min: six simultaneous submissions from one browser -- an
  // ordinary double-click storm -- got the sixth rejected with 429, so the
  // documented recovery path failed against the product's own rate limit.
  //
  // 20/min still bounds grinding to no practical effect: guessing a token is a
  // 64-hex-character search against a sha256 index, where the limit changes an
  // infeasible number into a slightly larger infeasible number. The real
  // protection is the token's entropy; this is defence in depth.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('register-invited')
  async registerInvited(@Body() body: RegisterInvitedDto) {
    return this.authService.registerInvited(body);
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

  /**
   * Called SERVER-SIDE ONLY, by the BFF. The capability it returns must never
   * reach a browser: it is minted and consumed within one server-side request
   * chain, so it is never stored, never put in a URL, and never handed to
   * client JavaScript.
   *
   * Rate-limited like register(): it is reachable without a session and each
   * call performs a bcrypt-free but still unauthenticated lookup, so it is a
   * plausible target for grinding invitation tokens.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('pre-session/invitation-capability')
  async mintInvitationCapability(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: MintInvitationCapabilityDto,
  ) {
    const preAuthToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    if (!preAuthToken) {
      throw new UnauthorizedException(
        'Missing pre-auth token from Authorization header',
      );
    }
    return this.authService.mintInvitationCapability(preAuthToken, body.token);
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
