#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PROJECT_ROOT_FULL_PATH="$ROOT"

# Android SDK — force correct path, ignore stale env vars
ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

print_usage() {
    echo "Usage: $0 [ios|android] [production|production-apk|staging|development-aab|development-apk|development|internal-adhoc]"
    echo "  -h  Display this help message."
}

while getopts ":h" option; do
    case "${option}" in
        h) print_usage; exit 0 ;;
        *) print_usage; exit 1 ;;
    esac
done
shift $((OPTIND-1))

if [ $# -ne 2 ]; then print_usage; exit 1; fi

PLATFORM="$1"
PROFILE="$2"

if [ "$PLATFORM" != "ios" ] && [ "$PLATFORM" != "android" ]; then
    echo "The first argument must be 'ios' or 'android'."; exit 1
fi

VALID_PROFILES="production production-apk staging development-aab development-apk development internal-adhoc"
if ! echo "$VALID_PROFILES" | grep -qw "$PROFILE"; then
    echo "The second argument must be one of: $VALID_PROFILES"; exit 1
fi

EXPO_DIR="$ROOT/apps/expo"
cd "$EXPO_DIR"

# Load .env
if [ -f .env ]; then
    set -a; source .env; set +a
fi

if [ "$PLATFORM" == "android" ]; then
    if [ ! -d "$ANDROID_HOME" ]; then
        echo "Error: ANDROID_HOME=$ANDROID_HOME not found. Install Android SDK first."
        exit 1
    fi

    echo "Building Android $PROFILE"

    # 1. Clean and regenerate native project
    npx expo prebuild --platform android --clean 2>&1 | tail -3

    # 2. Set SDK path
    echo "sdk.dir=$ANDROID_HOME" > android/local.properties

    # 3. Inject env vars into gradle.properties so Gradle can resolve manifest placeholders
    cat >> android/gradle.properties <<EOF

# Injected by build script — DO NOT COMMIT
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}
EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL=${EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL:-http://localhost:8088}
EOF

    # 4. Patch build.gradle with manifestPlaceholders
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

    cd android
    ./gradlew "$TASK" 2>&1 | tail -5
    cd ..

    APK=$(find android/app/build/outputs -name "*.apk" -type f | head -1)
    if [ -n "$APK" ]; then
        APK_DIR="$ROOT/local_eas_builds/artifacts"
        mkdir -p "$APK_DIR"
        cp "$APK" "$APK_DIR/"
        echo ""
        echo "DONE — APK: $APK_DIR/$(basename "$APK")"
        ls -lh "$APK_DIR"/*.apk
    else
        echo "Build failed — no APK found."
        exit 1
    fi

elif [ "$PLATFORM" == "ios" ]; then
    echo "Building iOS $PROFILE (requires macOS with Xcode)"
    EAS_LOCAL_BUILD_SKIP_CLEANUP=0 \
    EAS_LOCAL_BUILD_WORKINGDIR="$ROOT/local_eas_builds/ios" \
    EAS_LOCAL_BUILD_ARTIFACTS_DIR="$ROOT/local_eas_builds/artifacts" \
    eas build --platform ios --profile "$PROFILE" --local
fi
