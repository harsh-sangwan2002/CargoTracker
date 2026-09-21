/**
 * Xcode 27 replaced Simulator.app with DeviceHub (com.apple.dt.Devices).
 * Expo CLI for SDK 54 only looks for "Simulator", so pressing `i` fails with
 * "Can't determine id of Simulator app". This backports the DeviceHub support
 * and simulator-filtering that shipped in @expo/cli 57. Idempotent; runs on postinstall.
 */
const fs = require('fs');
const path = require('path');

let cliRoot;
try {
  cliRoot = path.dirname(
    require.resolve('@expo/cli/package.json', { paths: [path.dirname(require.resolve('expo/package.json'))] })
  );
} catch {
  console.warn('[patch-expo-devicehub] @expo/cli not found, skipping');
  process.exit(0);
}

const MARKER = '/* devicehub-patched */';

const patches = [
  {
    file: 'build/src/start/doctor/apple/SimulatorAppPrerequisite.js',
    edits: [
      [
        `return (await (0, _osascript().execAsync)('id of app "Simulator"')).trim();`,
        `return (await (0, _osascript().execAsync)('id of app "Simulator"')).trim();
    } catch {}
    try {
        return (await (0, _osascript().execAsync)('id of app "DeviceHub"')).trim();`,
      ],
      [
        `if (result !== 'com.apple.iphonesimulator' &&`,
        `if (result !== 'com.apple.dt.Devices' && result !== 'com.apple.iphonesimulator' &&`,
      ],
    ],
  },
  {
    file: 'build/src/start/platforms/ios/ensureSimulatorAppRunning.js',
    edits: [
      [
        `count processes whose name is "Simulator"'`,
        `count processes whose name is "Simulator" or name is "DeviceHub"'`,
      ],
      [
        `    await (0, _spawnasync().default)('open', args);
}`,
        `    try {
        await (0, _spawnasync().default)('open', args);
    } catch {
        // Xcode 27+: Simulator.app is gone; DeviceHub handles devices:// URLs.
        const deviceHubArgs = device.udid ? [
            \`devices://device/open?id=\${device.udid}\`
        ] : [
            '-a',
            'DeviceHub'
        ];
        await (0, _spawnasync().default)('open', deviceHubArgs).catch(()=>{});
    }
}`,
      ],
    ],
  },
  {
    // Xcode 27's devicectl also lists simulators; without this filter
    // `expo run:ios` treats the simulator as a physical device and demands signing.
    file: 'build/src/start/platforms/ios/devicectl.js',
    edits: [
      [
        `_devicesJson_info.jsonVersion) !== 2) {`,
        `_devicesJson_info.jsonVersion) !== 2 && devicesJson.info.jsonVersion !== 3 && devicesJson.info.jsonVersion !== 5) {`,
      ],
      [
        `    return devicesJson.result.devices;`,
        `    return devicesJson.result.devices.filter((device)=>{
        var _device_hardwareProperties;
        return (device == null ? void 0 : (_device_hardwareProperties = device.hardwareProperties) == null ? void 0 : _device_hardwareProperties.reality) !== 'simulated';
    });`,
      ],
    ],
  },
  {
    file: 'build/src/start/platforms/ios/AppleDeviceManager.js',
    edits: [
      [
        'await _osascript().execAsync(`tell application "Simulator" to activate`);',
        'await _osascript().execAsync(`if application "Simulator" is running then\\ntell application "Simulator" to activate\\nelse if application "DeviceHub" is running then\\ntell application "DeviceHub" to activate\\nend if`).catch(()=>{});',
      ],
    ],
  },
];

for (const { file, edits } of patches) {
  const fullPath = path.join(cliRoot, file);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[patch-expo-devicehub] missing ${file}, skipping`);
    continue;
  }
  let src = fs.readFileSync(fullPath, 'utf8');
  if (src.includes(MARKER)) continue;
  for (const [from, to] of edits) {
    if (!src.includes(from)) {
      console.warn(`[patch-expo-devicehub] pattern not found in ${file}; Expo may already support DeviceHub`);
      continue;
    }
    src = src.replace(from, to);
  }
  fs.writeFileSync(fullPath, `${MARKER}\n${src}`);
  console.log(`[patch-expo-devicehub] patched ${file}`);
}
