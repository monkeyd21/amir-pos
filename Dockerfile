# Stage 1: Build everything
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci

COPY shared/ ./shared/
COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN npm run build --workspace=shared
RUN cd backend && npx prisma generate && npm run build
RUN cd frontend && npx ng build --configuration production

# Compile seed script to JS
RUN cd backend && npx tsc --outDir seed-dist --rootDir . prisma/seed.ts --esModuleInterop --resolveJsonModule --skipLibCheck

# Stage 2: Production deps only
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev
COPY --from=builder /app/backend/prisma ./backend/prisma
RUN cd backend && npx prisma generate

# Stage 3: Final image
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# All production node_modules (hoisted by npm workspaces)
COPY --from=deps /app/node_modules ./node_modules

# Backend compiled JS
COPY --from=builder /app/backend/dist ./dist

# Prisma schema + migrations
COPY --from=builder /app/backend/prisma ./prisma

# Compiled seed script
COPY --from=builder /app/backend/seed-dist/prisma/seed.js ./prisma/seed.js

# Shared package (symlinked by workspace, copy explicitly)
COPY --from=builder /app/shared/dist ./node_modules/@clothing-erp/shared/dist
COPY --from=builder /app/shared/package.json ./node_modules/@clothing-erp/shared/package.json

# Angular frontend
COPY --from=builder /app/frontend/dist/frontend/browser ./public

ENV SEED_DB=false
EXPOSE 3000

COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e
./node_modules/.bin/prisma migrate deploy
if [ "$SEED_DB" = "true" ]; then
  echo "Seeding database..."
  node prisma/seed.js
  echo "Seeding complete. Set SEED_DB=false in Railway to skip on next deploy."
fi
node dist/server.js
EOF
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
