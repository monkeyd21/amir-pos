#!/usr/bin/env bash
# Build + release on the Oracle box. Run from the repo root: /opt/amir-pos
# Idempotent — safe to re-run. Builds shared → backend → frontend, runs DB
# migrations, copies the Angular build into backend/public, restarts the service.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root regardless of where it's called from
echo "▶ Deploying from $(pwd)"

echo "▶ Pulling latest main"
git pull --ff-only

echo "▶ Installing dependencies (all workspaces)"
npm ci

echo "▶ Building shared types"
npm run build --workspace=shared

echo "▶ Generating Prisma client + applying migrations"
( cd backend && npx prisma generate && npx prisma migrate deploy )

echo "▶ Building backend (tsc → backend/dist)"
npm run build --workspace=backend

echo "▶ Building Angular frontend (production)"
npm run build --workspace=frontend

echo "▶ Building storefront (Next.js)"
# SHOP_SITE_URL is baked into robots.txt and canonical URLs at build time, so
# it must be set HERE, not only in the systemd unit.
SHOP_SITE_URL="${SHOP_SITE_URL:-https://shop.sabihasethnic.com}" \
  npm run build --workspace=storefront

echo "▶ Publishing frontend into backend/public"
rm -rf backend/public
mkdir -p backend/public
cp -r frontend/dist/frontend/browser/. backend/public/

echo "▶ Restarting services"
sudo systemctl restart amir-pos
# Separate unit on :3001 — the storefront must not be able to take the till down.
sudo systemctl restart amir-shop

echo "✓ Deploy complete."
echo "  Till     : journalctl -u amir-pos -f"
echo "  Storefront: journalctl -u amir-shop -f"
