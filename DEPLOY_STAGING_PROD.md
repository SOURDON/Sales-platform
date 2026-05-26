# Staging and Production Rollout

This project is configured for two cloud environments:

- Staging
- Production

## 1) Neon PostgreSQL

Create two databases (or branches) in Neon:

- `sales_platform_staging`
- `sales_platform_prod`

Copy connection strings to:

- `DATABASE_URL_STAGING`
- `DATABASE_URL_PRODUCTION`

## 2) Render backend services

Use Render Web Service settings. For each service set:

- `DATABASE_URL` (staging/prod value)
- `CORS_ORIGIN` (exact frontend URL for this environment)

Root Directory:

`(empty)`

Build command in both services:

`cd backend && npm install && npx prisma generate && npm run build`

Start command (миграции + авто-починка P3009 для 0028):

`cd backend && npm run start:prod:db`

Не используйте отдельный `npx prisma migrate deploy` перед `start:prod` — при failed migration сервис не поднимется.

If you see `Root directory "backend" does not exist`, keep Root Directory empty and run `Manual Deploy -> Clear build cache & deploy`.

## 3) Vercel frontend environments

Set environment variables:

- Production: `VITE_API_URL=https://<prod-render-host>`
- Preview/Staging: `VITE_API_URL=https://<staging-render-host>`

## 4) Smoke checks after deploy

1. Login with `director` and the password from `DEMO_DEFAULT_PASSWORD`, or the built-in default `Foto-2026-9kLq` (see backend `.env.example`). Store admins use short logins `a1`…`a8`, sellers `s1`…, retouchers `r1`… (after `npm run db:sync` or first deploy, legacy `admin1`/`seller1`/`reto1` are renamed automatically).
2. Open shift, add sale, close shift.
3. Restart backend service in Render.
4. Reload UI and verify that shift/sale data is still present.

## 5) Backup baseline

Keep Neon managed backups enabled and verify restore by restoring a snapshot into staging.
