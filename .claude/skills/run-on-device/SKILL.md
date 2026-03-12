---
name: run-on-device
description: Build native iOS app and install on physical iPhone for testing
---

# Run on Device

Build and install the native iOS app on a physical iPhone or simulator.

## Arguments

- No args → dev build on connected physical device
- `prod` → production build (`.env.production`, Release config)
- `clean` → `npx expo prebuild --clean` before building
- `sim` → run on simulator instead of physical device
- `nuke` → nuclear cache clear (watchman + Metro + Xcode) then build

Arguments combine: `prod clean` → clean prebuild + production build on device.

## Pre-Flight Checklist (run EVERY build)

Execute these checks in order before running any build command. Stop on any BLOCKING failure.

### 1. Worktree Detection — BLOCKING

```bash
pwd
```

If the current working directory contains `.worktrees/` or `.claude/worktrees/`, **REFUSE TO BUILD**. Tell the user:

> Cannot build from a git worktree. Worktrees lack `.env.*` files (gitignored) and Expo CLI has Metro URL/device discovery issues with non-standard paths. Merge your changes to main and build from `/Users/sachitgoyal/code/lift-ai/`.

### 2. Env File Existence — BLOCKING

```bash
# For dev builds (default):
test -f .env.development && echo "OK" || echo "MISSING"

# For prod builds (when `prod` arg):
test -f .env.production && echo "OK" || echo "MISSING"
```

If MISSING, **REFUSE TO BUILD**. The app will launch with no Supabase connection.

### 3. Device Discovery — BLOCKING (device builds only, skip for `sim`)

Extract the hardware UDID from a paired device using JSON output:

```bash
xcrun devicectl list devices --json-output /tmp/devices.json 2>/dev/null
DEVICE_UDID=$(python3 -c "
import json
d = json.load(open('/tmp/devices.json'))
for dev in d['result']['devices']:
    if dev.get('connectionProperties',{}).get('pairingState') == 'paired':
        print(dev['hardwareProperties']['udid'])
        break
")
echo "UDID: $DEVICE_UDID"
```

- If `$DEVICE_UDID` is empty → **BLOCKING** (no paired device found). Tell the user their iPhone is not connected/trusted. Do NOT retry.
- **Store this UDID** and pass it to all subsequent `--device $DEVICE_UDID` commands. This avoids the interactive device selection prompt which fails in non-interactive mode.

**Two UDID formats exist** (both are normal):
- **Hardware UDID** (`00008130-...`): Used by `expo --device` and xcodebuild `-destination "id=..."`
- **devicectl identifier** (`393081C1-...`): Used by `xcrun devicectl device install/launch` commands

### 4. Swift Plugin Changes — AUTO-TRIGGER clean prebuild

```bash
git diff --name-only HEAD -- plugins/withInteractiveLiveActivity/swift/
git diff --name-only --cached -- plugins/withInteractiveLiveActivity/swift/
```

If ANY Swift files in the plugin directory have changed (staged or unstaged), **automatically add `clean` to the build** even if the user didn't request it. Inform them:

> Detected Swift plugin changes — forcing clean prebuild. `expo run:ios` won't re-copy plugin files if `ios/` already exists.

### 5. Port 8081 (Metro) — AUTO-FIX

```bash
lsof -ti:8081
```

If a process is using port 8081, kill it before building:

```bash
lsof -ti:8081 | xargs kill -9 2>/dev/null
```

**Note on Metro**: Dev (Debug) builds need Metro running — expo starts it automatically. **Prod (Release) builds embed the JS bundle and do NOT need Metro** — use `--no-bundler` to skip it.

## Build Commands

### Standard Builds

```bash
# Dev on physical device (DEFAULT)
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device $DEVICE_UDID

# Dev on simulator
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios

# Prod on physical device
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device $DEVICE_UDID --configuration Release --no-bundler

# Prod on simulator
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --configuration Release --no-bundler
```

Key details:
- `$DEVICE_UDID` is the hardware UDID extracted in pre-flight step 3
- `--no-bundler` on Release builds skips Metro (JS is bundled inline)
- `SENTRY_DISABLE_AUTO_UPLOAD=true` prevents build failure from missing Sentry auth token

### With Clean Prebuild

```bash
npx expo prebuild --clean
# then run the appropriate build command above
```

### Nuclear Cache Clear (`nuke` arg)

```bash
watchman watch-del-all
rm -rf /tmp/metro-*
# then run the appropriate build command with --no-build-cache:
# Dev:
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device $DEVICE_UDID --no-build-cache
# Prod (nuke + prod):
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device $DEVICE_UDID --configuration Release --no-bundler --no-build-cache
```

## xcodebuild Fallback

When expo CLI itself is broken (not just device selection), use xcodebuild directly.

### Build

```bash
xcodebuild clean build -workspace ios/liftai.xcworkspace -scheme liftai \
  -configuration Release -destination "id=$DEVICE_UDID" \
  -allowProvisioningUpdates \
  SENTRY_DISABLE_AUTO_UPLOAD=true 2>&1 | tail -30
```

For Debug builds, replace `-configuration Release` with `-configuration Debug`.

### Install

Uses the **devicectl identifier** (not the hardware UDID):

```bash
DEVICECTL_ID=$(python3 -c "
import json
d = json.load(open('/tmp/devices.json'))
for dev in d['result']['devices']:
    if dev.get('connectionProperties',{}).get('pairingState') == 'paired':
        print(dev['identifier'])
        break
")
xcrun devicectl device install app --device $DEVICECTL_ID \
  ~/Library/Developer/Xcode/DerivedData/lift-ai-*/Build/Products/Release-iphoneos/liftai.app
```

### Launch

```bash
xcrun devicectl device process launch --device $DEVICECTL_ID com.sachitgoyal.liftai
```

### Metro for Debug xcodebuild builds

If using xcodebuild fallback for a Debug build, Metro won't auto-start. Start it manually:

```bash
npx expo start
```

## NEVER DO THIS

| Mistake | Why it breaks | Do this instead |
|---------|--------------|-----------------|
| `--device` (bare, no UDID) | Triggers interactive prompt → fails in non-interactive mode | `--device $DEVICE_UDID` with UDID from pre-flight step 3 |
| Build from a git worktree | Missing `.env.*`, Metro path issues | Merge to main, build from project root |
| Skip clean prebuild after Swift plugin edits | `expo run:ios` won't re-copy plugin files to `ios/` | Always `npx expo prebuild --clean` after editing `plugins/**/swift/` |
| Retry the same failing command | Wastes time, won't fix root cause | Diagnose first, then fix |
| Omit `SENTRY_DISABLE_AUTO_UPLOAD=true` | Build fails on missing Sentry auth token locally | Always prefix local builds |
| Run two Metro bundlers | Port conflict, stale bundles | Kill port 8081 first |
| Use Expo Go | Live Activity, native modules won't work | Always use native build (`expo run:ios`) |
| Swap dev↔prod without cache clear | Stale env vars from Metro/Expo cache | `npx expo start --clear` or nuke |
| `npx expo prebuild` (without `--clean`) | Stale native files may persist | Always use `--clean` flag |
| Start Metro for Release builds | Metro not needed, wastes resources | Use `--no-bundler` for Release/prod builds |

## Troubleshooting (Diagnosis-First)

When a build fails, **diagnose before retrying**. Read the error output carefully.

### Signing / Provisioning Errors

- Open `ios/liftai.xcworkspace` in Xcode
- Select the project → Signing & Capabilities → set team to `574YNGX64S`
- Ensure bundle ID is `com.sachitgoyal.liftai`
- For xcodebuild: add `-allowProvisioningUpdates` flag

### CocoaPods Errors

```bash
cd ios && pod install --repo-update && cd ..
```

If pods are deeply broken:
```bash
cd ios && rm -rf Pods Podfile.lock && pod install && cd ..
```

### Device Not Found

1. Check physical cable connection
2. Run pre-flight step 3 to extract UDID — if empty, device is not paired
3. Unlock the phone and trust the computer
4. UDID formats differ between hardware UDID and devicectl identifier — this is normal (see step 3)

### Stale Environment Variables

Symptoms: app connects to wrong Supabase instance, features behave unexpectedly after switching dev↔prod.

```bash
# Clear Metro cache
npx expo start --clear

# Or nuclear:
watchman watch-del-all && rm -rf /tmp/metro-* && npx expo run:ios --device $DEVICE_UDID --no-build-cache
```

### Live Activity / Widget Issues

- **Plugin order matters**: `withInteractiveLiveActivity` must run AFTER `expo-live-activity` in `app.config.ts` plugins array
- **Zero-parameter intents**: All 3 intents (DecreaseRest/IncreaseRest/SkipRest) must be zero-parameter structs — parameterized `@Parameter` intents fail silently on Live Activity buttons
- **App Groups**: Group ID is `group.com.sachitgoyal.liftai` — must match in both RN module and Swift widget
- **Swift changes not taking effect**: Force clean prebuild (`npx expo prebuild --clean`) — this is the #1 cause

### Metro Crashes / Bundling Errors

```bash
# Kill existing Metro
lsof -ti:8081 | xargs kill -9 2>/dev/null

# Clear caches
watchman watch-del-all
rm -rf /tmp/metro-*
rm -rf node_modules/.cache

# Retry
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device $DEVICE_UDID
```

### App Crashes on Launch

1. Open Xcode → Window → Devices and Simulators → select device → View Device Logs
2. Look for the crash log matching `com.sachitgoyal.liftai`
3. Common causes: missing env vars, SQLite migration error, native module mismatch
4. If crash is in a native module, try clean prebuild

## Reference

| Property | Value |
|----------|-------|
| Bundle ID | `com.sachitgoyal.liftai` |
| App Group | `group.com.sachitgoyal.liftai` |
| URL Scheme | `liftai://` |
| Project Root | `/Users/sachitgoyal/code/lift-ai` |
| Apple Team ID | `574YNGX64S` |
| Xcode Workspace | `ios/liftai.xcworkspace` |
| Xcode Scheme | `liftai` |
| Xcode Project | `ios/liftai.xcodeproj` |
| Swift Plugin Path | `plugins/withInteractiveLiveActivity/swift/` |
| Plugin Config | `plugins/withInteractiveLiveActivity/withInteractiveLiveActivity.js` |
| Plugin Order | `expo-live-activity` THEN `withInteractiveLiveActivity` |
| Sentry Org/Project | `sachit-goyal` / `react-native` |
| Dev Supabase Ref | `gcpnqpqqwcwvyzoivolp` |
| Prod Supabase Ref | `lgnkxjiqzsqiwrqrsxww` |
| EAS Project ID | `405310db-a7c7-4d03-9f82-81a752ede55d` |
| Metro Port | `8081` |
