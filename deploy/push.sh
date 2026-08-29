#!/usr/bin/env bash
# Deploy to production from this machine.
#
#   ./deploy/push.sh                # build HEAD locally, ship artifacts, restart
#   ./deploy/push.sh --allow-dirty  # deploy the working tree as-is
#   ./deploy/push.sh --skip-build   # reuse the last local build
#
# This does NOT run `prisma migrate deploy`. Prod's migration history does not
# match the repo's (34 rows recorded vs 41 on the box vs 45 here, plus a failed
# 20260508210000_add_held_transactions row), so `migrate deploy` aborts on the
# first already-existing table and leaves a failed row behind. Schema changes on
# this box are applied by hand from deploy/sql/*.sql. If schema.prisma has
# changed, this script ships it and regenerates the client only -- it never
# issues DDL. Apply the matching SQL yourself first, then deploy.
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
  echo "  Apply the matching deploy/sql/*.sql to prod first if you have not."
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

if [ '$SEND_SCHEMA' = '1' ]; then
  echo '▶ Updating schema.prisma + regenerating client (no DDL)'
  cp backend/prisma/schema.prisma backend/prisma/schema.prisma.prev
  cp \$S/schema.prisma backend/prisma/schema.prisma
  ( cd backend && npx prisma generate )
fi

echo '▶ Swapping in the new build (previous kept as .prev)'
rm -rf backend/dist.prev backend/public.prev
if [ -d backend/dist   ]; then mv backend/dist   backend/dist.prev;   fi
if [ -d backend/public ]; then mv backend/public backend/public.prev; fi
mv \$S/backend/dist   backend/dist
mv \$S/backend/public backend/public
cp \$S/.release-commit .release-commit
chown -R amir:amir backend/dist backend/public backend/prisma .release-commit

echo '▶ Restarting amir-pos'
systemctl restart amir-pos
sleep 4
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
