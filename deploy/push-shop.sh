#!/usr/bin/env bash
# Deploy the storefront to production.
#
#   ./deploy/push-shop.sh              # build here, ship, restart, smoke check
#   ./deploy/push-shop.sh --skip-build # reuse the last local build
#
# Same philosophy as push.sh: EVERYTHING is built on this machine. The box only
# receives Next.js's traced standalone bundle and can run `node server.js` with
# no npm install, no source and no credentials.
#
# This never touches the database. Apply schema changes to prod yourself first
# with `prisma migrate deploy`, see docs/deploy-notes.md.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
SKIP_BUILD=0
for a in "$@"; do
  case "$a" in
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

SITE_URL="${SHOP_SITE_URL:-https://shop.sabihasethnic.com}"
VENV="$ROOT/deploy/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"; "$VENV/bin/pip" install -q paramiko
fi
PY="$VENV/bin/python"
remote_run() { "$PY" "$ROOT/deploy/remote.py" run "$1"; }
remote_put() { "$PY" "$ROOT/deploy/remote.py" put "$1" "$2"; }

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "▶ Building shared"
  npm run build --workspace=shared
  echo "▶ Building storefront (SHOP_SITE_URL=$SITE_URL)"
  # Baked into robots.txt and every canonical URL — must be right at BUILD time.
  SHOP_SITE_URL="$SITE_URL" npm run build --workspace=storefront
fi
[ -d storefront/.next/standalone ] || { echo "✗ standalone build missing" >&2; exit 1; }

# ------------------------------------------------------------------ package --
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/release"
cp -a storefront/.next/standalone/. "$STAGE/release/"
# The standalone tracer excludes static assets and the public dir; add them.
mkdir -p "$STAGE/release/storefront/.next"
cp -a storefront/.next/static "$STAGE/release/storefront/.next/static"
[ -d storefront/public ] && cp -a storefront/public "$STAGE/release/storefront/public"
git rev-parse HEAD > "$STAGE/release/.release-commit"

TAR="$STAGE/amir-shop-release.tar.gz"
tar -czf "$TAR" -C "$STAGE" release
echo "▶ Packaged: $(du -h "$TAR" | cut -f1)"
remote_put "$TAR" /tmp/amir-shop-release.tar.gz

# -------------------------------------------------------- release on the box --
remote_run "set -euo pipefail
mkdir -p /opt/amir-shop
cd /opt/amir-shop

echo '▶ Unpacking'
rm -rf /tmp/amir-shop-staging && mkdir -p /tmp/amir-shop-staging
tar -xzf /tmp/amir-shop-release.tar.gz -C /tmp/amir-shop-staging
test -f /tmp/amir-shop-staging/release/storefront/server.js

echo '▶ Swapping in (previous kept as .prev)'
rm -rf app.prev
[ -d app ] && mv app app.prev || true
mv /tmp/amir-shop-staging/release app
id -u amir >/dev/null 2>&1 && chown -R amir:amir /opt/amir-shop || true

echo '▶ Restarting amir-shop'
systemctl restart amir-shop 2>/dev/null || echo '  (unit not installed yet)'
rm -rf /tmp/amir-shop-release.tar.gz /tmp/amir-shop-staging"

echo "▶ Smoke check"
sleep 4
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$SITE_URL/")
SIZE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$SITE_URL/size-guide")
echo "  /           -> $CODE"
echo "  /size-guide -> $SIZE"
if [ "$CODE" != "200" ]; then
  echo "✗ Smoke check failed. Roll back with:" >&2
  echo "    cd /opt/amir-shop && rm -rf app && mv app.prev app && systemctl restart amir-shop" >&2
  exit 1
fi
echo "✓ Storefront deployed to $SITE_URL"
