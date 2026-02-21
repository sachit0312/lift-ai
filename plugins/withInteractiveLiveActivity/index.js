const {
  withEntitlementsPlist,
  withXcodeProject,
  withDangerousMod,
  withPlugins,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const APP_GROUP_ID = 'group.com.sachitgoyal.liftai';
const WIDGET_TARGET_NAME = 'LiveActivity';

// New Swift files to add to the widget target (not replacing existing ones)
const NEW_SWIFT_FILES = [
  'WorkoutIntents.swift',
  'WorkoutUserDefaultsHelper.swift',
];

// Swift files that replace expo-live-activity defaults
const REPLACEMENT_FILES = {
  'InteractiveLiveActivityView.swift': 'LiveActivityView.swift',
  'InteractiveLiveActivityWidget.swift': 'LiveActivityWidget.swift',
};

/**
 * Config plugin for interactive Live Activity lock screen controls.
 * Must be listed AFTER expo-live-activity in app.config.ts plugins array.
 *
 * This plugin:
 * 1. Copies enhanced Swift files to ios/LiveActivity/ (overwriting expo-live-activity defaults)
 * 2. Adds new Swift files (intents, helpers) to the widget target
 * 3. Adds App Groups entitlement to both main app and widget extension
 */
function withInteractiveLiveActivity(config) {
  return withPlugins(config, [
    withAppGroupsEntitlement,
    withWidgetFiles,
    withWidgetXcodeProject,
  ]);
}

// Step 1: Add App Groups entitlement to main app
function withAppGroupsEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.security.application-groups'] = [APP_GROUP_ID];
    return config;
  });
}

// Step 2: Copy Swift files to ios/LiveActivity/ and update widget entitlements
function withWidgetFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const platformProjectRoot = config.modRequest.platformProjectRoot;
      const widgetPath = path.join(platformProjectRoot, WIDGET_TARGET_NAME);
      const pluginSwiftDir = path.join(__dirname, 'swift');

      // Ensure widget directory exists
      if (!fs.existsSync(widgetPath)) {
        fs.mkdirSync(widgetPath, { recursive: true });
      }

      // Copy replacement files (overwrite expo-live-activity defaults)
      for (const [source, dest] of Object.entries(REPLACEMENT_FILES)) {
        const sourcePath = path.join(pluginSwiftDir, source);
        const destPath = path.join(widgetPath, dest);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destPath);
          console.log(`[withInteractiveLiveActivity] Replaced ${dest}`);
        }
      }

      // Copy new Swift files
      for (const file of NEW_SWIFT_FILES) {
        const sourcePath = path.join(pluginSwiftDir, file);
        const destPath = path.join(widgetPath, file);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destPath);
          console.log(`[withInteractiveLiveActivity] Copied ${file}`);
        }
      }

      // Write App Groups entitlement to widget extension
      const entitlementsPath = path.join(widgetPath, `${WIDGET_TARGET_NAME}.entitlements`);
      const plist = require('@expo/plist');
      const entitlements = {
        'com.apple.security.application-groups': [APP_GROUP_ID],
      };
      fs.writeFileSync(entitlementsPath, plist.default.build(entitlements));
      console.log(`[withInteractiveLiveActivity] Updated widget entitlements with App Groups`);

      return config;
    },
  ]);
}

// Step 3: Add new Swift files to the widget target in Xcode project
function withWidgetXcodeProject(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    // Find the LiveActivity native target
    const nativeTargets = xcodeProject.pbxNativeTargetSection();
    let widgetTargetUuid = null;

    for (const key in nativeTargets) {
      const target = nativeTargets[key];
      if (typeof target === 'object' && target.name != null) {
        const name = target.name.replace(/"/g, '');
        if (name === WIDGET_TARGET_NAME) {
          widgetTargetUuid = key;
          break;
        }
      }
    }

    if (!widgetTargetUuid) {
      console.warn('[withInteractiveLiveActivity] Could not find LiveActivity target in Xcode project');
      return config;
    }

    // Find the existing PBXSourcesBuildPhase for the widget target
    const target = nativeTargets[widgetTargetUuid];
    let sourcesBuildPhaseUuid = null;

    if (target.buildPhases) {
      for (const phase of target.buildPhases) {
        const phaseUuid = phase.value;
        const buildPhases = xcodeProject.hash.project.objects['PBXSourcesBuildPhase'];
        if (buildPhases && buildPhases[phaseUuid]) {
          sourcesBuildPhaseUuid = phaseUuid;
          break;
        }
      }
    }

    // Find the LiveActivity PBX group
    const groups = xcodeProject.hash.project.objects['PBXGroup'];
    let widgetGroupKey = null;

    for (const key in groups) {
      const group = groups[key];
      if (typeof group === 'object' && group.name != null) {
        const name = group.name.replace(/"/g, '');
        if (name === WIDGET_TARGET_NAME) {
          widgetGroupKey = key;
          break;
        }
      }
    }

    // Add each new Swift file to the project
    for (const fileName of NEW_SWIFT_FILES) {
      const fileRefUuid = xcodeProject.generateUuid();
      const buildFileUuid = xcodeProject.generateUuid();

      // Add file reference
      xcodeProject.hash.project.objects['PBXFileReference'] =
        xcodeProject.hash.project.objects['PBXFileReference'] || {};
      xcodeProject.hash.project.objects['PBXFileReference'][fileRefUuid] = {
        isa: 'PBXFileReference',
        lastKnownFileType: 'sourcecode.swift',
        path: fileName,
        sourceTree: '"<group>"',
      };
      xcodeProject.hash.project.objects['PBXFileReference'][`${fileRefUuid}_comment`] = fileName;

      // Add build file
      xcodeProject.hash.project.objects['PBXBuildFile'] =
        xcodeProject.hash.project.objects['PBXBuildFile'] || {};
      xcodeProject.hash.project.objects['PBXBuildFile'][buildFileUuid] = {
        isa: 'PBXBuildFile',
        fileRef: fileRefUuid,
        fileRef_comment: fileName,
      };
      xcodeProject.hash.project.objects['PBXBuildFile'][`${buildFileUuid}_comment`] = `${fileName} in Sources`;

      // Add to sources build phase
      if (sourcesBuildPhaseUuid) {
        const buildPhases = xcodeProject.hash.project.objects['PBXSourcesBuildPhase'];
        const phase = buildPhases[sourcesBuildPhaseUuid];
        if (phase && phase.files) {
          phase.files.push({
            value: buildFileUuid,
            comment: `${fileName} in Sources`,
          });
        }
      }

      // Add to PBX group
      if (widgetGroupKey && groups[widgetGroupKey].children) {
        groups[widgetGroupKey].children.push({
          value: fileRefUuid,
          comment: fileName,
        });
      }

      console.log(`[withInteractiveLiveActivity] Added ${fileName} to widget target`);
    }

    return config;
  });
}

module.exports = withInteractiveLiveActivity;
