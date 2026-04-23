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

    const result = this.authService.login(body.nickname, body.password);
    if (!result) {
      throw new UnauthorizedException('wrong nickname or password');
    }

    return result;
  }
}
