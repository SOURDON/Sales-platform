# Sales Platform Starter

Monorepo for the sales accounting app:
- `backend` - NestJS API
- `frontend` - React + Vite web app (can be adapted for mobile cashier PWA)

## Requirements

- Windows 10+
- Node.js with npm available
- PostgreSQL (install later, when we connect the database)

## Run locally

### Backend

```bash
cd backend
npm install
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

Environment variables examples:
- Backend: `backend/.env.example`
- Frontend: `frontend/.env.example`

## Verified commands

Both projects already compile:

- `backend`: `npm run build`
- `frontend`: `npm run build`

## Deploy (public URL, independent of your PC)

Recommended stack:
- Backend: Render (Web Service)
- Frontend + PWA: Vercel

### 1) Deploy backend to Render

1. Push this repository to GitHub.
2. In Render create a new **Web Service** from the repo:
   - Root Directory: `backend`
   - Build Command: `npm ci && npm run build`
   - Start Command: `npm run start:prod`
3. Add environment variables:
   - `PORT=3000`
   - `CORS_ORIGIN=https://<your-frontend-domain>`
4. Deploy and copy backend URL, e.g. `https://sales-platform-api.onrender.com`.

### 2) Deploy frontend to Vercel

1. In Vercel import the same repository.
2. Configure:
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. Add env variable:
   - `VITE_API_URL=https://<your-backend-domain>`
4. Deploy and open frontend URL.

### 3) Allow frontend origin in backend

Set `CORS_ORIGIN` on Render to your real frontend URL from Vercel.

### 4) Install on phone as PWA

- iOS (Safari): Share -> Add to Home Screen.
- Android (Chrome): Install app / Add to Home Screen.

## Notes about data persistence

Current backend uses in-memory demo state. The app will be publicly accessible after deploy, but data resets when backend restarts.

Next step for production persistence:
1. Provision PostgreSQL (Neon/Supabase/Render Postgres).
2. Add ORM migration layer (Prisma/TypeORM).
3. Move current in-memory entities to database tables.

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
