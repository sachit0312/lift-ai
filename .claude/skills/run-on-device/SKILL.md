---
name: run-on-device
description: Build native iOS app and install on physical iPhone for testing
---

# Run on Device

Build and install the native iOS app on a physical iPhone.

## Arguments

- No args → build dev and run on connected device
- `prod` → build with production env (`.env.production`)
- `clean` → prebuild clean first, then build and run
- `sim` → run on simulator instead of device

Arguments can be combined: `prod clean` → clean prebuild + production build.

## Steps

1. **Check if prebuild is needed** (only when `clean` arg or native project is missing/stale)
   ```bash
   npx expo prebuild --clean
   ```
   This is needed after:
   - Adding new native plugins (e.g., expo-live-activity)
   - Changing `app.config.ts` plugin configuration
   - Updating Expo SDK version

2. **Build and run**
   ```bash
   # Physical device, dev (default — loads .env.development)
   npx expo run:ios --device "iPhone"

   # Physical device, production (loads .env.production)
   npx expo run:ios --device "iPhone" --configuration Release

   # Simulator, dev
   npx expo run:ios

   # Simulator, production
   npx expo run:ios --configuration Release
   ```

3. **Report** — Show:
   - Build success/failure
   - Device name if available
   - Any build warnings worth noting

## Troubleshooting

- **"No development team"**: Open `ios/workout-enhanced.xcodeproj` in Xcode, set signing team
- **Build fails after plugin change**: Run with `clean` arg to regenerate native project
- **Metro bundler issues**: Kill existing Metro with `lsof -ti:8081 | xargs kill -9` then retry
- **CocoaPods issues**: `cd ios && pod install --repo-update && cd ..`

## Important Notes

- Live Activity requires a native build — it does NOT work in Expo Go
- Bundle ID: `com.anonymous.workout-enhanced`
- Always test on physical iPhone, not simulator, for full feature coverage
