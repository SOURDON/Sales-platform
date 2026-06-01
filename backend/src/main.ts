import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  const corsOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  /** Tauri 2: prod webview + dev (Vite на localhost:5173). */
  const isDesktopAppOrigin = (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }
    if (origin.startsWith('tauri://')) {
      return true;
    }
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (host === 'tauri.localhost' || host.endsWith('.tauri.localhost')) {
        return true;
      }
      if (
        url.protocol === 'http:' &&
        (host === 'localhost' || host === '127.0.0.1')
      ) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  /** Сайт по IP на Timeweb (http://77.x.x.x) — иначе браузер даёт «Ошибка входа: 500». */
  const isAllowedWebOrigin = (origin: string | undefined): boolean => {
    if (!origin) {
      return false;
    }
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
      }
      const host = url.hostname;
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        return true;
      }
      const site = process.env.SITE_DOMAIN?.trim();
      if (site && (host === site || host === `www.${site}`)) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  app.enableCors({
    origin:
      corsOrigins.length > 0
        ? (
            origin: string | undefined,
            callback: (error: Error | null, allow?: boolean) => void,
          ) => {
            if (
              !origin ||
              corsOrigins.includes(origin) ||
              isDesktopAppOrigin(origin) ||
              isAllowedWebOrigin(origin)
            ) {
              callback(null, true);
              return;
            }
            callback(null, false);
          }
        : true,
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
