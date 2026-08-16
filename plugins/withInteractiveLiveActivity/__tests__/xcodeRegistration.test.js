const fs = require('fs');
const os = require('os');
const path = require('path');
const xcode = require('xcode');
const {
  addSwiftFilesToXcodeProject,
} = require('../index');

const SWIFT_FILES = [
  'LiveActivityAttributes.swift',
  'RestTimerIntents.swift',
  'RestTimerSnapshotStore.swift',
];

function targetSourcePaths(pbxprojPath, targetName) {
  const project = xcode.project(pbxprojPath);
  project.parseSync();
  const objects = project.hash.project.objects;
  const targets = objects.PBXNativeTarget;
  const targetKey = Object.keys(targets).find((key) => {
    if (key.endsWith('_comment')) return false;
    return String(targets[key]?.name ?? '').replaceAll('"', '') === targetName;
  });
  if (!targetKey) throw new Error(`Missing target ${targetName}`);

  const sourcesPhaseKey = targets[targetKey].buildPhases
    .map((phase) => phase.value)
    .find((key) => objects.PBXSourcesBuildPhase?.[key]);
  if (!sourcesPhaseKey) throw new Error(`Missing sources phase for ${targetName}`);

  return objects.PBXSourcesBuildPhase[sourcesPhaseKey].files.map(({ value }) => {
    const buildFile = objects.PBXBuildFile[value];
    const fileRef = objects.PBXFileReference[buildFile.fileRef];
    return String(fileRef.path ?? '').replaceAll('"', '');
  });
}

describe('withInteractiveLiveActivity Xcode registration', () => {
  let temporaryRoot;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'liftai-live-activity-'));
    const projectDir = path.join(temporaryRoot, 'liftai.xcodeproj');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'ios/liftai.xcodeproj/project.pbxproj'),
      path.join(projectDir, 'project.pbxproj'),
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('adds each shared Swift source exactly once to the app and widget targets', () => {
    addSwiftFilesToXcodeProject(temporaryRoot, 'liftai', SWIFT_FILES);
    addSwiftFilesToXcodeProject(temporaryRoot, 'liftai', SWIFT_FILES);

    const pbxprojPath = path.join(temporaryRoot, 'liftai.xcodeproj/project.pbxproj');
    for (const targetName of ['liftai', 'LiveActivity']) {
      const paths = targetSourcePaths(pbxprojPath, targetName);
      for (const fileName of SWIFT_FILES) {
        expect(paths.filter((sourcePath) => sourcePath === fileName)).toHaveLength(1);
      }
    }
  });
});
