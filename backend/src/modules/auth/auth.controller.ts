import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(
    @Body()
    body: {
      email: string;
      passwordPlain: string;
      firstName: string;
      lastName: string;
      workspaceName: string;
      subdomain: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Post('login')
  async login(
    @Body() body: { email: string; passwordPlain: string },
  ) {
    return this.authService.login(body.email, body.passwordPlain);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: any) {
    return user;
  }
}
