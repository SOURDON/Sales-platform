import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';

interface DecisionBody {
  decision?: 'APPROVE' | 'REJECT';
}

@Controller('director')
export class DirectorController {
  constructor(private readonly authService: AuthService) {}

  @Get('commission-requests')
  getRequests(@Headers('authorization') authorization?: string) {
    this.requireDirector(authorization);
    return this.authService.getCommissionChangeRequests() as unknown;
  }

  @Post('commission-requests/:id/decision')
  async decide(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: DecisionBody,
    @Param('id') id: string,
  ) {
    this.requireDirector(authorization);
    if (!body.decision || (body.decision !== 'APPROVE' && body.decision !== 'REJECT')) {
      throw new BadRequestException('decision must be APPROVE or REJECT');
    }
    const result = await this.authService.decideCommissionRequest(id, body.decision);
    if (!result) {
      throw new BadRequestException('Request not found or already decided');
    }
    return result as unknown;
  }

  private requireDirector(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }
    const session = this.authService.parseToken(token);
    if (!session || session.role !== 'DIRECTOR') {
      throw new UnauthorizedException('Only director allowed');
    }
    return session;
  }
}
