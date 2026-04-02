FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY shared/ ./shared/
COPY backend/ ./backend/
RUN npm install --workspace=shared --workspace=backend
RUN npm run build --workspace=shared
RUN cd backend && npx prisma generate && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/shared/dist ./shared/dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
