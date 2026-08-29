#!/usr/bin/env bash
# bug4 — build the mobile POS APK.
#
#   ./deploy/build-apk.sh            # debug APK -> dist-apk/amir-pos-debug.apk
#   ./deploy/build-apk.sh --release  # unsigned release build
#
# The APK talks to https://erp.sabihasethnic.com/api/v1 (see
# frontend/src/environments/api-url.ts) — a real domain with a real certificate,
# so it needs no tunnel and no laptop running.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
VARIANT=debug
GRADLE_TASK=assembleDebug
for a in "$@"; do
  case "$a" in
    --release) VARIANT=release; GRADLE_TASK=assembleRelease ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

# The Android SDK is not part of `npm ci`; install it once with the Google
# command-line tools. 462 MB, and gradle cannot proceed without it.
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
if [ ! -d "$SDK/platforms" ]; then
  cat >&2 <<EOF
✗ Android SDK not found at $SDK

  Install it once (no Android Studio needed):
    mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
    curl -O https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
    unzip commandlinetools-linux-11076708_latest.zip && mv cmdline-tools latest
    yes | latest/bin/sdkmanager --licenses
    latest/bin/sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
EOF
  exit 1
fi
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
echo "sdk.dir=$SDK" > frontend/android/local.properties

[ -d node_modules ] || { echo "▶ Installing dependencies"; npm ci; }

echo "▶ Building web assets"
( cd frontend && npx ng build --configuration=development )

echo "▶ Syncing into the native project"
( cd frontend && npx cap sync android )

echo "▶ Gradle $GRADLE_TASK"
( cd frontend/android && ./gradlew "$GRADLE_TASK" --no-daemon )

mkdir -p dist-apk
SRC=$(find frontend/android/app/build/outputs/apk/$VARIANT -name '*.apk' | head -1)
OUT="$ROOT/dist-apk/amir-pos-$VARIANT.apk"
cp "$SRC" "$OUT"

echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"
echo "  Install on a connected phone:  adb install -r $OUT"
if [ "$VARIANT" = release ]; then
  echo "  NOTE: this release build is UNSIGNED — sign it before distributing."
fi
