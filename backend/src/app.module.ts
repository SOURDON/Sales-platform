import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { AdminController } from './admin/admin.controller';
import { DirectorController } from './director/director.controller';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [],
  controllers: [
    AppController,
    AuthController,
    DashboardController,
    AdminController,
    DirectorController,
  ],
  providers: [AppService, AuthService, PrismaService],
})
export class AppModule {}
