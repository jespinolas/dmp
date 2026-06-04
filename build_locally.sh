#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PROJECT_ROOT_FULL_PATH="$ROOT"

# Android SDK
ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

print_usage() {
    echo "Usage: $0 [ios|android] [development|development-apk|production|production-apk|staging]"
    echo ""
    echo "  ios development     iOS dev build (for iOS Simulator or device)"
    echo "  ios production      iOS App Store build"
    echo "  android development-apk  Android debug APK"
    echo "  android production-apk   Android release APK"
    echo "  android production       Android App Bundle (Play Store)"
    echo "  android staging          Android staging build"
    echo ""
    echo "  -h  Display this help message."
}

while getopts ":h" option; do
    case "${option}" in
        h) print_usage; exit 0 ;;
        *) print_usage; exit 1 ;;
    esac
done
shift $((OPTIND-1))

if [ $# -lt 2 ]; then
    print_usage
    exit 1
fi

PLATFORM="$1"
PROFILE="$2"

if [ "$PLATFORM" != "ios" ] && [ "$PLATFORM" != "android" ]; then
    echo "The first argument must be 'ios' or 'android'."
    exit 1
fi

EXPO_DIR="$ROOT/apps/expo"
cd "$EXPO_DIR"

# Load .env
if [ -f .env ]; then
    set -a; source .env; set +a
fi

# Local build dirs
ANDROID_BUILD_DIR="$ROOT/local_eas_builds/android"
IOS_BUILD_DIR="$ROOT/local_eas_builds/ios"
ARTIFACTS_DIR="$ROOT/local_eas_builds/artifacts"
mkdir -p "$ANDROID_BUILD_DIR" "$IOS_BUILD_DIR" "$ARTIFACTS_DIR"

# ── Android ──────────────────────────────────────────────────────────────────

if [ "$PLATFORM" == "android" ]; then
    if [ ! -d "$ANDROID_HOME" ]; then
        echo "Error: ANDROID_HOME=$ANDROID_HOME not found."
        echo "Install Android SDK to ~/Library/Android/sdk/"
        exit 1
    fi

    echo "Building Android $PROFILE"

    # 1. Prebuild native project
    npx expo prebuild --platform android --clean 2>&1 | tail -1

    # 2. SDK path
    echo "sdk.dir=$ANDROID_HOME" > android/local.properties

    # 3. Inject env vars
    cat >> android/gradle.properties <<EOF

# Injected by build script — DO NOT COMMIT
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}
EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL=${EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL:-http://localhost:8088}
EOF

    # 4. Patch build.gradle
    if ! grep -q "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY" android/app/build.gradle; then
        sed -i '' '/versionName.*0\.1\.0/a\
        manifestPlaceholders = [\
            EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: project.findProperty("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY") ?: "",\
            EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL: project.findProperty("EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL") ?: ""\
        ]' android/app/build.gradle
    fi

    # 5. Build
    TASK="assembleDebug"
    if [ "$PROFILE" = "production" ] || [ "$PROFILE" = "production-apk" ]; then
        TASK="assembleRelease"
    fi

    cd android && ./gradlew "$TASK" 2>&1 | tail -3 && cd ..

    APK=$(find android/app/build/outputs -name "*.apk" -type f | head -1)
    if [ -n "$APK" ]; then
        cp "$APK" "$ARTIFACTS_DIR/"
        echo ""
        echo "DONE — APK: $ARTIFACTS_DIR/$(basename "$APK")"
        ls -lh "$ARTIFACTS_DIR"/*.apk
    else
        echo "Build failed — no APK found."
        exit 1
    fi

# ── iOS ──────────────────────────────────────────────────────────────────────

elif [ "$PLATFORM" == "ios" ]; then
    echo "Building iOS $PROFILE"

    # iOS local builds use EAS — requires Xcode installed
    if ! xcodebuild -version &>/dev/null; then
        echo "Error: Xcode not found. Install Xcode from the App Store."
        exit 1
    fi

    echo "Xcode: $(xcodebuild -version | head -1)"

    # Map profile names
    EAS_PROFILE="$PROFILE"
    case "$PROFILE" in
        development-apk) EAS_PROFILE="development" ;;
        production-apk)  EAS_PROFILE="production" ;;
    esac

    EAS_LOCAL_BUILD_SKIP_CLEANUP=0 \
    EAS_LOCAL_BUILD_WORKINGDIR="$IOS_BUILD_DIR" \
    EAS_LOCAL_BUILD_ARTIFACTS_DIR="$ARTIFACTS_DIR" \
    eas build --platform ios --profile "$EAS_PROFILE" --local

    echo ""
    echo "DONE — check $ARTIFACTS_DIR"
    ls -lh "$ARTIFACTS_DIR/" 2>/dev/null || echo "(no artifacts yet)"
fi
