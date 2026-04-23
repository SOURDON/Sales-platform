import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly authService: AuthService) {}

  @Get('overview')
  getOverview(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    const session = this.authService.parseToken(token);
    if (!session) {
      throw new UnauthorizedException('Invalid token');
    }

    return this.authService.getDashboardOverview(session.nickname) as unknown;
  }
}
