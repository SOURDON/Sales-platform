# Sales Platform Starter

Monorepo for the sales accounting app:
- `backend` - NestJS API
- `frontend` - React + Vite web app (can be adapted for mobile cashier PWA)

## Requirements

- Windows 10+
- Node.js with npm available
- PostgreSQL (Neon recommended for cloud deployment)

## Run locally

### Backend

```bash
cd backend
npm install
copy .env.example .env
npm run start:dev
```

Backend default URL: `http://localhost:3000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

Environment variable examples:
- Backend: `backend/.env.example`
- Backend staging: `backend/.env.staging.example`
- Backend production: `backend/.env.production.example`
- Frontend: `frontend/.env.example`
- Frontend staging: `frontend/.env.staging.example`
- Frontend production: `frontend/.env.production.example`

## Verified commands

Both projects already compile:

- `backend`: `npm run build`
- `frontend`: `npm run build`

## Deploy (public URL, independent of your PC)

Recommended stack:
- PostgreSQL: Neon
- Backend: Render (Web Service)
- Frontend + PWA: Vercel

### 0) Create PostgreSQL in Neon (staging + prod)

1. Create a Neon project.
2. Create two databases (or branches):
   - `sales_platform_staging`
   - `sales_platform_prod`
3. Copy both connection strings as:
   - `DATABASE_URL_STAGING`
   - `DATABASE_URL_PRODUCTION`
4. Managed backups:
   - keep Neon default PITR/backup retention enabled
   - test restore into staging at least once

### 1) Deploy backend to Render

1. Push this repository to GitHub.
2. In Render create a new **Web Service** from the repo:
   - Root Directory: leave empty
   - Build Command: `cd backend && npm install && npx prisma generate && npm run build`
   - Start Command: `cd backend && npx prisma migrate deploy && npm run start:prod`
3. Add environment variables:
   - `PORT=3000`
   - `DATABASE_URL=<DATABASE_URL_PRODUCTION>`
   - `CORS_ORIGIN=https://<your-frontend-domain>`
4. Deploy and copy backend URL, e.g. `https://sales-platform-api.onrender.com`.

### 2) Deploy frontend to Vercel (production)

1. In Vercel import the same repository.
2. Configure:
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. Add env variable:
   - `VITE_API_URL=https://<your-backend-domain>`
4. Deploy and open frontend URL.

### 3) Deploy staging backend + staging frontend

- Render staging backend:
  - Root Directory: leave empty
  - Build Command: `cd backend && npm install && npx prisma generate && npm run build`
  - Start Command: `cd backend && npx prisma migrate deploy && npm run start:prod`
  - Env:
    - `PORT=3000`
    - `DATABASE_URL=<DATABASE_URL_STAGING>`
    - `CORS_ORIGIN=https://<staging-vercel-domain>`
- Vercel staging frontend:
  - Use Preview/branch deployment or separate project
  - Set `VITE_API_URL=https://<staging-render-domain>`

### 4) Allow frontend origin in backend

Set `CORS_ORIGIN` on Render to your real frontend URL from Vercel.

### 4.1) Anti-break checklist for Render path issues

If Render shows `Root directory "backend" does not exist`:

1. Set Root Directory to empty.
2. Use build/start commands with explicit `cd backend` as shown above.
3. Run `Manual Deploy -> Clear build cache & deploy`.
4. Verify in logs that Nest maps `/auth/login` and service becomes `Live`.

### 5) Install on phone as PWA

- iOS (Safari): Share -> Add to Home Screen.
- Android (Chrome): Install app / Add to Home Screen.

## Persistence status

Backend now persists operational state in PostgreSQL through Prisma models and seed/migration scripts.
Data no longer resets after API restarts when `DATABASE_URL` points to Neon/managed Postgres.

## Next implementation steps

1. Add PostgreSQL and ORM (Prisma or TypeORM).
2. Implement authentication: nickname + password + JWT.
3. Add roles: director, store admin, seller.
4. Add shift lifecycle: open/close shift.
5. Add product and inventory accounting (purchase, sale, write-off).
6. Add sales calculations:
   - seller commission by personal percent rate
   - acquiring fee for card payments
   - net profit per sale
7. Add director reports by store and for all stores.
8. Add export (CSV/XLSX) and 3-hour notification job.
