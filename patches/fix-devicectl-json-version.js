/**
 * Patches @expo/cli devicectl.js to accept jsonVersion 3
 * (Xcode 26.2 / devicectl 506.6).
 *
 * Upstream fix: https://github.com/expo/expo/pull/42859 (SDK 55)
 * Not backported to SDK 54.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo',
  'node_modules',
  '@expo',
  'cli',
  'build',
  'src',
  'start',
  'platforms',
  'ios',
  'devicectl.js'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch] devicectl.js not found, skipping');
  process.exit(0);
}

const original = fs.readFileSync(filePath, 'utf8');
const needle = '_devicesJson_info.jsonVersion) !== 2)';
const replacement = '_devicesJson_info.jsonVersion)) || ![2, 3].includes(devicesJson.info.jsonVersion))';

if (original.includes('![2, 3].includes')) {
  console.log('[patch] devicectl.js already patched');
  process.exit(0);
}

if (!original.includes(needle)) {
  console.log('[patch] devicectl.js does not contain expected pattern, skipping');
  process.exit(0);
}

// Replace the full condition with the includes-based version
const patched = original.replace(
  /if \(.*?_devicesJson_info\.jsonVersion\) !== 2\)/,
  'if (![2, 3].includes(devicesJson == null ? void 0 : (_devicesJson_info = devicesJson.info) == null ? void 0 : _devicesJson_info.jsonVersion))'
);

fs.writeFileSync(filePath, patched, 'utf8');
console.log('[patch] devicectl.js patched to accept jsonVersion 2 and 3');
