---
name: run-on-device
description: Build native iOS app and install on physical iPhone for testing
disable-model-invocation: true
---

# Run on Device

Build and install the native iOS app on a physical iPhone.

## Arguments

- No args → build and run on connected device
- `clean` → prebuild clean first, then build and run
- `sim` → run on simulator instead of device

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
   # Physical device (default, preferred)
   npx expo run:ios --device

   # Simulator
   npx expo run:ios
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
