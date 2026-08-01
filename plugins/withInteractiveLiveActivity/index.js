const {
  withEntitlementsPlist,
  withFinalizedMod,
  withPlugins,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const APP_GROUP_ID = 'group.com.sachitgoyal.liftai';
const WIDGET_TARGET_NAME = 'LiveActivity';

// New Swift files to add to the widget target (not replacing existing ones).
// Empty: interactive buttons removed — widget is now read-only.

// Swift files that replace expo-live-activity defaults
const REPLACEMENT_FILES = {
  'InteractiveLiveActivityView.swift': 'LiveActivityView.swift',
  'InteractiveLiveActivityWidget.swift': 'LiveActivityWidget.swift',
};

/**
 * Config plugin for interactive Live Activity lock screen controls.
 * Must be listed AFTER expo-live-activity in app.config.ts plugins array.
 *
 * Execution order of Expo config plugin mod types:
 *   dangerous (-2) → xcodeproj (-1) → ... → finalized (1)
 *
 * expo-live-activity creates the LiveActivity target and writes default Swift files
 * AND empty widget entitlements in withXcodeProject (priority -1). We must do ALL
 * our customizations AFTER that, so we use:
 *   - withFinalizedMod to copy Swift files, merge widget entitlements, and add
 *     new files to Xcode project (runs AFTER xcodeproj at priority 1)
 */
function withInteractiveLiveActivity(config) {
  return withPlugins(config, [
    withAppGroupsEntitlement,
    withWidgetXcodeProjectFinalized,
  ]);
}

// Add App Groups entitlement to main app
function withAppGroupsEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.security.application-groups'] = [APP_GROUP_ID];
    return config;
  });
}

// Copy Swift files, merge widget entitlements, and add new files to Xcode project
// using withFinalizedMod.
// This runs AFTER withXcodeProject (priority -1) where expo-live-activity creates
// the LiveActivity target and writes default Swift files. By copying here, our
// interactive replacements overwrite the defaults and persist into the final build.
function withWidgetXcodeProjectFinalized(config) {
  return withFinalizedMod(config, [
    'ios',
    (config) => {
      const { platformProjectRoot, projectName } = config.modRequest;

      const widgetPath = path.join(platformProjectRoot, WIDGET_TARGET_NAME);
      const pluginSwiftDir = path.join(__dirname, 'swift');

      // Copy replacement files (overwrite expo-live-activity defaults)
      for (const [source, dest] of Object.entries(REPLACEMENT_FILES)) {
        const sourcePath = path.join(pluginSwiftDir, source);
        const destPath = path.join(widgetPath, dest);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destPath);
          console.log(`[withInteractiveLiveActivity] Replaced ${dest} (finalized)`);
        }
      }

      // Verify replacement worked by checking for the interactive struct name
      const viewPath = path.join(widgetPath, 'LiveActivityView.swift');
      if (fs.existsSync(viewPath)) {
        const content = fs.readFileSync(viewPath, 'utf8');
        if (content.includes('InteractiveLiveActivityView')) {
          console.log(`[withInteractiveLiveActivity] ✓ Verified: LiveActivityView.swift contains interactive version`);
        } else {
          console.warn(`[withInteractiveLiveActivity] ✗ WARNING: LiveActivityView.swift does NOT contain interactive version`);
        }
      }

      // Merge App Groups entitlement into widget extension
      // (must happen here in finalized, AFTER expo-live-activity writes empty entitlements in xcodeproj)
      const entitlementsPath = path.join(widgetPath, `${WIDGET_TARGET_NAME}.entitlements`);
      const plist = require('@expo/plist');
      let entitlements = {};
      if (fs.existsSync(entitlementsPath)) {
        const existing = fs.readFileSync(entitlementsPath, 'utf8');
        entitlements = plist.default.parse(existing);
      }
      entitlements['com.apple.security.application-groups'] = [APP_GROUP_ID];
      fs.writeFileSync(entitlementsPath, plist.default.build(entitlements));
      console.log(`[withInteractiveLiveActivity] ✓ Merged App Groups entitlement into widget entitlements (finalized)`);

      // NOTE: this plugin only OVERWRITES files expo-live-activity already registered in the
      // pbxproj (see REPLACEMENT_FILES), so there is nothing to add to the Xcode target. The
      // ~130 lines of pbxproj surgery that used to run here iterated an empty file list and
      // rewrote the project on every prebuild for no effect. If a genuinely new Swift file is
      // ever needed in the widget target, restore it from git history rather than re-deriving.
      return config;
    },
  ]);
}

module.exports = withInteractiveLiveActivity;
