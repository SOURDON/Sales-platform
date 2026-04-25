FROM node:20-alpine AS builder

WORKDIR /app



COPY package*.json ./

RUN npm ci



COPY . .

RUN npm run build



FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production



COPY package*.json ./

COPY prisma ./prisma

RUN npm ci --omit=dev



COPY --from=builder /app/dist ./dist



EXPOSE 3000

# Миграции и идемпотентный сид при старте (нужен DATABASE_URL; как npm run start:prod:db)

CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/src/main.js"]

