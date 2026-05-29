FROM node:20-alpine AS builder

WORKDIR /app

# Prisma на Alpine нужен OpenSSL; schema — до npm ci (postinstall → prisma generate)
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma

ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma

ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
