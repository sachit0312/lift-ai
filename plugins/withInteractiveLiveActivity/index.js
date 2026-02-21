const {
  withEntitlementsPlist,
  withDangerousMod,
  withFinalizedMod,
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
 * Execution order of Expo config plugin mod types:
 *   dangerous (-2) → xcodeproj (-1) → ... → finalized (1)
 *
 * expo-live-activity creates the LiveActivity target in withXcodeProject.
 * We use:
 *   - withDangerousMod for file copies + entitlements (runs before xcodeproj, no dependency)
 *   - withFinalizedMod to add Swift files to Xcode project (runs AFTER xcodeproj,
 *     so the LiveActivity target exists on disk)
 */
function withInteractiveLiveActivity(config) {
  return withPlugins(config, [
    withAppGroupsEntitlement,
    withWidgetFiles,
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

// Copy Swift files and update widget entitlements (filesystem only, no Xcode project dependency)
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

      // Merge App Groups entitlement into widget extension (preserving existing entitlements)
      const entitlementsPath = path.join(widgetPath, `${WIDGET_TARGET_NAME}.entitlements`);
      const plist = require('@expo/plist');
      let entitlements = {};
      if (fs.existsSync(entitlementsPath)) {
        const existing = fs.readFileSync(entitlementsPath, 'utf8');
        entitlements = plist.default.parse(existing);
      }
      entitlements['com.apple.security.application-groups'] = [APP_GROUP_ID];
      fs.writeFileSync(entitlementsPath, plist.default.build(entitlements));
      console.log(`[withInteractiveLiveActivity] Updated widget entitlements with App Groups`);

      return config;
    },
  ]);
}

// Add new Swift files to the Xcode project using withFinalizedMod
// This runs AFTER withXcodeProject (where expo-live-activity creates the LiveActivity target)
function withWidgetXcodeProjectFinalized(config) {
  return withFinalizedMod(config, [
    'ios',
    (config) => {
      const { platformProjectRoot, projectName } = config.modRequest;
      addFilesToXcodeProject(platformProjectRoot, projectName);
      return config;
    },
  ]);
}

// Directly modify the .pbxproj file to add Swift files to the widget target
function addFilesToXcodeProject(platformProjectRoot, projectName) {
  const xcode = require('xcode');
  const pbxprojPath = path.join(
    platformProjectRoot,
    `${projectName}.xcodeproj`,
    'project.pbxproj'
  );

  if (!fs.existsSync(pbxprojPath)) {
    console.warn('[withInteractiveLiveActivity] Could not find .pbxproj file');
    return;
  }

  const project = xcode.project(pbxprojPath);
  project.parseSync();

  // Find the LiveActivity native target
  const nativeTargets = project.pbxNativeTargetSection();
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
    return;
  }

  // Find the existing PBXSourcesBuildPhase for the widget target
  const target = nativeTargets[widgetTargetUuid];
  let sourcesBuildPhaseUuid = null;

  if (target.buildPhases) {
    for (const phase of target.buildPhases) {
      const phaseUuid = phase.value;
      const buildPhases = project.hash.project.objects['PBXSourcesBuildPhase'];
      if (buildPhases && buildPhases[phaseUuid]) {
        sourcesBuildPhaseUuid = phaseUuid;
        break;
      }
    }
  }

  // Find the LiveActivity PBX group
  const groups = project.hash.project.objects['PBXGroup'];
  let widgetGroupKey = null;

  for (const key in groups) {
    if (key.endsWith('_comment')) continue;
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
    // Check if file is already in the project (idempotency)
    const fileRefs = project.hash.project.objects['PBXFileReference'] || {};
    let alreadyExists = false;
    for (const refKey in fileRefs) {
      const ref = fileRefs[refKey];
      if (typeof ref === 'object' && ref.path === fileName) {
        alreadyExists = true;
        break;
      }
    }
    if (alreadyExists) {
      console.log(`[withInteractiveLiveActivity] ${fileName} already in project, skipping`);
      continue;
    }

    const fileRefUuid = project.generateUuid();
    const buildFileUuid = project.generateUuid();

    // Add file reference
    project.hash.project.objects['PBXFileReference'][fileRefUuid] = {
      isa: 'PBXFileReference',
      lastKnownFileType: 'sourcecode.swift',
      path: fileName,
      sourceTree: '"<group>"',
    };
    project.hash.project.objects['PBXFileReference'][`${fileRefUuid}_comment`] = fileName;

    // Add build file
    project.hash.project.objects['PBXBuildFile'] =
      project.hash.project.objects['PBXBuildFile'] || {};
    project.hash.project.objects['PBXBuildFile'][buildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: fileRefUuid,
      fileRef_comment: fileName,
    };
    project.hash.project.objects['PBXBuildFile'][`${buildFileUuid}_comment`] = `${fileName} in Sources`;

    // Add to sources build phase
    if (sourcesBuildPhaseUuid) {
      const buildPhases = project.hash.project.objects['PBXSourcesBuildPhase'];
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

  fs.writeFileSync(pbxprojPath, project.writeSync());
}

module.exports = withInteractiveLiveActivity;
