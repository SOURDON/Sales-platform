import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';

interface DecisionBody {
  decision?: 'APPROVE' | 'REJECT';
}

interface SetDemoPasswordBody {
  password?: string;
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

  @Get('control-requests')
  listControlRequests(@Headers('authorization') authorization?: string) {
    this.requireDirector(authorization);
    return this.authService.getDirectorControlRequestsSnapshot() as unknown;
  }

  @Post('control-requests/:id/decision')
  async decideControlRequest(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: DecisionBody,
    @Param('id') id: string,
  ) {
    const session = this.requireDirector(authorization);
    if (!body.decision || (body.decision !== 'APPROVE' && body.decision !== 'REJECT')) {
      throw new BadRequestException('decision must be APPROVE or REJECT');
    }
    const result = await this.authService.decideDirectorControlRequest(id, body.decision, session.nickname);
    if (!result.ok) {
      if (result.error === 'not_found') {
        throw new BadRequestException('Заявка не найдена или уже обработана');
      }
      if (result.error === 'sale_missing') {
        throw new BadRequestException('Продажа уже удалена или недоступна');
      }
      if (result.error === 'writeoff_failed') {
        throw new BadRequestException('Не удалось выполнить списание (остаток или данные)');
      }
      throw new BadRequestException('Не удалось применить решение');
    }
    return { ok: true } as unknown;
  }

  @Get('demo-accounts')
  listDemoAccounts(@Headers('authorization') authorization?: string) {
    this.requireDirector(authorization);
    return this.authService.directorListDemoAccounts() as unknown;
  }

  @Patch('demo-accounts/:nickname/password')
  setDemoAccountPassword(
    @Headers('authorization') authorization: string | undefined,
    @Param('nickname') nickname: string,
    @Body() body: SetDemoPasswordBody,
  ) {
    const session = this.requireDirector(authorization);
    const targetNick = decodeURIComponent(nickname.trim());
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9._-]+$/.test(targetNick)) {
      throw new BadRequestException('invalid nickname');
    }
    const pwd = body.password?.trim();
    if (!pwd) {
      throw new BadRequestException('password is required');
    }
    const result = this.authService.directorSetDemoUserPassword(session.nickname, targetNick, pwd);
    if (!result.ok) {
      if (result.error === 'bad_password') {
        throw new BadRequestException('password must be 10–128 characters');
      }
      if (result.error === 'not_found') {
        throw new BadRequestException('user not found');
      }
      if (result.error === 'role_not_allowed') {
        throw new BadRequestException('Пароль можно менять только у бухгалтера, управляющего или админа точки');
      }
      throw new UnauthorizedException('Only director allowed');
    }
    return { ok: true } as unknown;
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
