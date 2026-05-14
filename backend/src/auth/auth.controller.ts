import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

interface LoginBody {
  nickname?: string;
  password?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginBody) {
    if (!body.nickname || !body.password) {
      throw new BadRequestException('nickname and password are required');
    }
    const nick = body.nickname.trim();
    const pwd = body.password;
    if (nick.length < 1 || nick.length > 64 || pwd.length < 1 || pwd.length > 128) {
      throw new BadRequestException('invalid nickname or password length');
    }

    const result = this.authService.login(nick, pwd);
    if (!result) {
      throw new UnauthorizedException('wrong nickname or password');
    }

    return result;
  }
}
