#!/usr/bin/env bash
# Deploy to production from this machine.
#
#   ./deploy/push.sh                # build HEAD locally, ship artifacts, restart
#   ./deploy/push.sh --allow-dirty  # deploy the working tree as-is
#   ./deploy/push.sh --skip-build   # reuse the last local build
#
# This script does NOT apply migrations. If schema.prisma has changed, it ships
# it and regenerates the Prisma client only -- it never issues DDL. Apply the
# schema change to prod yourself first, then deploy.
#
# Since 2026-09-04 that means `prisma migrate deploy`: prod's migration history
# was repaired that day and now matches the repo exactly (45 recorded entries,
# 45 migration directories, nothing unfinished). It used to be broken, which is
# why deploy/sql/*.sql exists; see docs/deploy-notes.md.
#
# Everything is BUILT HERE. The box only ever receives compiled output:
#   backend/dist  backend/public  backend/prisma
# It gets no source, no Dockerfile, no deploy scripts and no credentials, so
# nothing on the box is able to deploy the box. Rollback lives in
# backend/dist.prev and backend/public.prev.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
ALLOW_DIRTY=0
SKIP_BUILD=0
for a in "$@"; do
  case "$a" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-build)  SKIP_BUILD=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

VENV="$ROOT/deploy/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "▶ Creating deploy venv (paramiko — the box is password-auth only)"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q paramiko
fi
PY="$VENV/bin/python"
remote_run() { "$PY" "$ROOT/deploy/remote.py" run "$1"; }
remote_put() { "$PY" "$ROOT/deploy/remote.py" put "$1" "$2"; }

# ---------------------------------------------------------------- preflight --
SHA=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
  if [ "$ALLOW_DIRTY" -eq 0 ]; then
    echo "✗ Uncommitted changes present. Commit them, or pass --allow-dirty." >&2
    exit 1
  fi
  SHORT="$SHORT-dirty"
fi
echo "▶ Deploying $BRANCH @ $SHORT"

# -------------------------------------------------------------------- build --
if [ "$SKIP_BUILD" -eq 0 ]; then
  [ -d node_modules ] || { echo "▶ Installing dependencies"; npm ci; }
  echo "▶ Building shared"
  npm run build --workspace=shared
  echo "▶ Generating Prisma client"
  ( cd backend && npx prisma generate )
  echo "▶ Building backend (tsc)"
  npm run build --workspace=backend
  echo "▶ Building frontend (production)"
  npm run build --workspace=frontend
fi
[ -d backend/dist ] || { echo "✗ backend/dist missing — build first" >&2; exit 1; }
[ -d frontend/dist/frontend/browser ] || { echo "✗ frontend build output missing" >&2; exit 1; }

# ------------------------------------------------------------------ package --
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/release/backend"
cp -a backend/dist "$STAGE/release/backend/dist"
# The box resolves @clothing-erp/shared through a symlink to /opt/amir-pos/shared,
# so its dist must ship too. This is not optional: since the shop module, the
# backend imports real VALUES from shared at runtime (not just types), and a
# stale shared/dist crash-loops the service on boot. Learned the hard way.
[ -d shared/dist ] || { echo "✗ shared/dist missing — build shared first" >&2; exit 1; }
mkdir -p "$STAGE/release/shared"
cp -a shared/dist "$STAGE/release/shared/dist"
mkdir -p "$STAGE/release/backend/public"
cp -a frontend/dist/frontend/browser/. "$STAGE/release/backend/public/"
echo "$SHA" > "$STAGE/release/.release-commit"

# Ship schema.prisma only when it differs from the box, so the common deploy
# touches nothing DB-related at all.
LOCAL_SCHEMA=$(md5sum backend/prisma/schema.prisma | cut -d' ' -f1)
REMOTE_SCHEMA=$(remote_run 'md5sum /opt/amir-pos/backend/prisma/schema.prisma 2>/dev/null | cut -d" " -f1' | tr -d '\r\n ')
SEND_SCHEMA=0
if [ "$LOCAL_SCHEMA" != "$REMOTE_SCHEMA" ]; then
  SEND_SCHEMA=1
  cp backend/prisma/schema.prisma "$STAGE/release/schema.prisma"
  echo "⚠ schema.prisma differs from the box."
  echo "  The new schema + a client regen will be shipped, but NO DDL is run."
  echo "  Apply the migration to prod first (prisma migrate deploy) if you have not."
fi

TAR="$STAGE/amir-pos-release.tar.gz"
tar -czf "$TAR" -C "$STAGE" release
echo "▶ Packaged release: $(du -h "$TAR" | cut -f1)"
remote_put "$TAR" /tmp/amir-pos-release.tar.gz

# -------------------------------------------------------- release on the box --
remote_run "set -euo pipefail
cd /opt/amir-pos

echo '▶ Unpacking release'
rm -rf /tmp/amir-pos-staging
mkdir -p /tmp/amir-pos-staging
tar -xzf /tmp/amir-pos-release.tar.gz -C /tmp/amir-pos-staging
S=/tmp/amir-pos-staging/release
test -d \$S/backend/dist
test -d \$S/backend/public
test -d \$S/shared/dist

if [ '$SEND_SCHEMA' = '1' ]; then
  echo '▶ Updating schema.prisma + regenerating client (no DDL)'
  cp backend/prisma/schema.prisma backend/prisma/schema.prisma.prev
  cp \$S/schema.prisma backend/prisma/schema.prisma
  ( cd backend && npx prisma generate )
fi

echo '▶ Swapping in the new build (previous kept as .prev)'
rm -rf backend/dist.prev backend/public.prev shared/dist.prev
if [ -d backend/dist   ]; then mv backend/dist   backend/dist.prev;   fi
if [ -d backend/public ]; then mv backend/public backend/public.prev; fi
if [ -d shared/dist    ]; then mv shared/dist    shared/dist.prev;    fi
mv \$S/backend/dist   backend/dist
mv \$S/backend/public backend/public
mv \$S/shared/dist    shared/dist
cp \$S/.release-commit .release-commit
chown -R amir:amir backend/dist backend/public backend/prisma shared/dist .release-commit

echo '▶ Restarting amir-pos'
systemctl restart amir-pos
sleep 6

# AUTO-ROLLBACK. A bad build used to leave the till crash-looping until a human
# noticed and ran the rollback by hand. The shop is open while we deploy; it
# restores itself in seconds instead.
if ! systemctl is-active --quiet amir-pos; then
  echo '✗ Service did not come up — ROLLING BACK automatically'
  journalctl -u amir-pos -n 15 --no-pager | tail -15
  rm -rf backend/dist backend/public shared/dist
  mv backend/dist.prev backend/dist
  mv backend/public.prev backend/public
  mv shared/dist.prev shared/dist
  if [ -f backend/prisma/schema.prisma.prev ]; then
    mv backend/prisma/schema.prisma.prev backend/prisma/schema.prisma
    ( cd backend && npx prisma generate >/dev/null 2>&1 )
  fi
  systemctl restart amir-pos
  sleep 5
  echo \"  rolled back; service is now: \$(systemctl is-active amir-pos)\"
  exit 1
fi
systemctl is-active amir-pos
rm -rf /tmp/amir-pos-release.tar.gz /tmp/amir-pos-staging"

# -------------------------------------------------------------- smoke check --
echo "▶ Smoke check"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://erp.sabihasethnic.com/api/v1/health)
APP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://erp.sabihasethnic.com/)
echo "  /api/v1/health -> $CODE"
echo "  /              -> $APP"
if [ "$CODE" != "200" ] || [ "$APP" != "200" ]; then
  echo "✗ Smoke check failed. Roll back on the box with:" >&2
  echo "    cd /opt/amir-pos && rm -rf backend/dist backend/public \\" >&2
  echo "      && mv backend/dist.prev backend/dist && mv backend/public.prev backend/public \\" >&2
  echo "      && systemctl restart amir-pos" >&2
  exit 1
fi
echo "✓ Deployed $BRANCH @ $SHORT"
