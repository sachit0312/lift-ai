const {
  withEntitlementsPlist,
  withFinalizedMod,
  withPlugins,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const APP_GROUP_ID = 'group.com.sachitgoyal.liftai';
const WIDGET_TARGET_NAME = 'LiveActivity';

// Shared by the app and widget targets. App Intents must be discoverable by the
// containing app, while the widget also needs the intent and ActivityAttributes
// types in order to render interactive controls.
const SHARED_SWIFT_FILES = [
  'LiveActivityAttributes.swift',
  'RestTimerIntents.swift',
  'RestTimerSnapshotStore.swift',
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

      // Copy shared sources beside the widget files, then compile the same source
      // files into both targets so ActivityKit sees one compatible schema.
      for (const fileName of SHARED_SWIFT_FILES) {
        const sourcePath = path.join(pluginSwiftDir, fileName);
        const destPath = path.join(widgetPath, fileName);
        fs.copyFileSync(sourcePath, destPath);
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

      addSwiftFilesToXcodeProject(
        platformProjectRoot,
        projectName,
        SHARED_SWIFT_FILES,
      );
      return config;
    },
  ]);
}

function unquote(value) {
  return String(value ?? '').replaceAll('"', '');
}

function addSwiftFilesToXcodeProject(platformProjectRoot, projectName, fileNames) {
  const xcode = require('xcode');
  const projectPath = path.join(
    platformProjectRoot,
    `${projectName}.xcodeproj`,
    'project.pbxproj',
  );
  const project = xcode.project(projectPath);
  project.parseSync();

  const objects = project.hash.project.objects;
  const nativeTargets = objects.PBXNativeTarget;
  const targetNames = [projectName, WIDGET_TARGET_NAME];
  const sourcePhases = targetNames.map((targetName) => {
    const targetKey = Object.keys(nativeTargets).find(
      (key) => !key.endsWith('_comment') && unquote(nativeTargets[key]?.name) === targetName,
    );
    if (!targetKey) {
      throw new Error(`[withInteractiveLiveActivity] Missing Xcode target: ${targetName}`);
    }

    const phaseKey = nativeTargets[targetKey].buildPhases
      .map((phase) => phase.value)
      .find((key) => objects.PBXSourcesBuildPhase?.[key]);
    if (!phaseKey) {
      throw new Error(`[withInteractiveLiveActivity] Missing Sources phase: ${targetName}`);
    }
    return { targetName, phaseKey };
  });

  const liveActivityGroupKey = Object.keys(objects.PBXGroup).find((key) => {
    if (key.endsWith('_comment')) return false;
    const group = objects.PBXGroup[key];
    return unquote(group?.name ?? group?.path) === WIDGET_TARGET_NAME;
  });
  if (!liveActivityGroupKey) {
    throw new Error('[withInteractiveLiveActivity] Missing LiveActivity Xcode group');
  }
  const liveActivityGroup = objects.PBXGroup[liveActivityGroupKey];

  for (const fileName of fileNames) {
    let fileRefKey = Object.keys(objects.PBXFileReference).find(
      (key) => !key.endsWith('_comment') && unquote(objects.PBXFileReference[key]?.path) === fileName,
    );
    if (!fileRefKey) {
      fileRefKey = project.generateUuid();
      objects.PBXFileReference[fileRefKey] = {
        isa: 'PBXFileReference',
        lastKnownFileType: 'sourcecode.swift',
        path: fileName,
        sourceTree: '"<group>"',
      };
      objects.PBXFileReference[`${fileRefKey}_comment`] = fileName;
    }

    if (!liveActivityGroup.children.some((child) => child.value === fileRefKey)) {
      liveActivityGroup.children.push({ value: fileRefKey, comment: fileName });
    }

    for (const { targetName, phaseKey } of sourcePhases) {
      const sourcePhase = objects.PBXSourcesBuildPhase[phaseKey];
      const alreadyIncluded = sourcePhase.files.some(({ value }) => (
        objects.PBXBuildFile[value]?.fileRef === fileRefKey
      ));
      if (alreadyIncluded) continue;

      const buildFileKey = project.generateUuid();
      const buildFileComment = `${fileName} in Sources`;
      objects.PBXBuildFile[buildFileKey] = {
        isa: 'PBXBuildFile',
        fileRef: fileRefKey,
        fileRef_comment: fileName,
      };
      objects.PBXBuildFile[`${buildFileKey}_comment`] = buildFileComment;
      sourcePhase.files.push({ value: buildFileKey, comment: buildFileComment });
      console.log(
        `[withInteractiveLiveActivity] Added ${fileName} to ${targetName} Sources`,
      );
    }
  }

  fs.writeFileSync(projectPath, project.writeSync());
}

module.exports = withInteractiveLiveActivity;
module.exports.addSwiftFilesToXcodeProject = addSwiftFilesToXcodeProject;
