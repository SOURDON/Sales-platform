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

Use `render.yaml` in this repository. For each service set:

- `DATABASE_URL` (staging/prod value)
- `CORS_ORIGIN` (exact frontend URL for this environment)

Build command in both services:

`npm ci && npm run build && npm run prisma:migrate:deploy && npm run prisma:seed`

Start command:

`npm run start:prod`

## 3) Vercel frontend environments

Set environment variables:

- Production: `VITE_API_URL=https://<prod-render-host>`
- Preview/Staging: `VITE_API_URL=https://<staging-render-host>`

## 4) Smoke checks after deploy

1. Login with `director / 123456`.
2. Open shift, add sale, close shift.
3. Restart backend service in Render.
4. Reload UI and verify that shift/sale data is still present.

## 5) Backup baseline

Keep Neon managed backups enabled and verify restore by restoring a snapshot into staging.
