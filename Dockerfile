# Stage 1: Build shared, backend, and frontend
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace config and package files
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install all dependencies
RUN npm ci

# Copy source code
COPY shared/ ./shared/
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Build shared types
RUN npm run build --workspace=shared

# Generate Prisma client and build backend
RUN cd backend && npx prisma generate && npm run build

# Build Angular frontend for production
RUN cd frontend && npx ng build --configuration production

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app

# Copy backend build output
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/backend/package.json ./package.json

# Copy shared types
COPY --from=builder /app/shared/dist ../shared/dist
COPY --from=builder /app/shared/package.json ../shared/package.json

# Copy Prisma CLI and seed dependencies (pinned to project version, not latest)
COPY --from=builder /app/backend/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/backend/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/backend/prisma/seed.ts ./prisma/seed.ts
COPY --from=builder /app/node_modules/ts-node ./node_modules/ts-node
COPY --from=builder /app/node_modules/typescript ./node_modules/typescript

# Copy Angular frontend build to be served by Express
COPY --from=builder /app/frontend/dist/frontend/browser ./public

# SEED_DB=true on first deploy to seed data, then remove it
ENV SEED_DB=false

EXPOSE 3000
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e
./node_modules/.bin/prisma migrate deploy
if [ "$SEED_DB" = "true" ]; then
  echo "Seeding database..."
  ./node_modules/.bin/ts-node prisma/seed.ts
  echo "Seeding complete. Set SEED_DB=false in Railway to skip on next deploy."
fi
node dist/server.js
EOF
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
