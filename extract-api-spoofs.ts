import { Project } from "ts-morph";

const project = new Project();
const stealthFile = project.addSourceFileAtPath("src/stealth/stealth-scripts.ts");
const apiFile = project.createSourceFile("src/stealth/scripts/api-spoofs.ts", "", { overwrite: true });

const fnsToExtract = [
  "getBatteryApiSpoofScript",
  "getPermissionsApiSpoofScript",
  "getSpeechVoicesSpoofScript",
  "getAntiVmDetectionScript",
  "getIncognitoEvasionScript",
  "getDevToolsEvasionScript",
  "getNotificationConsistencyScript",
  "getScreenConsistencyScript",
  "getPerformanceTimingSpoofScript",
  "getGamepadsSpoofScript",
  "getDeviceOrientationSpoofScript",
  "getGeolocationSpoofScript",
  "getIndexedDBConsistencyScript",
  "getClipboardConsistencyScript",
  "getWebUsbSpoofScript",
  "getNavigatorConnectionSpoofScript",
  "getPerformanceMemorySpoofScript",
  "getCSSSupportsSpoofScript",
  "getFeaturePolicyScript",
  "getCrossOriginIsolationScript"
];

for (const fnName of fnsToExtract) {
  const fn = stealthFile.getFunction(fnName);
  if (fn) {
    apiFile.addFunction({
      ...fn.getStructure(),
      isExported: true
    });
    fn.remove();
  }
}

// Ensure the new module imports any required types/functions if needed. 
// None of these seem to rely on types from other files that aren't self-contained, except maybe seed which is just a number.

// Export them from stealth-scripts.ts so it doesn't break external consumers
stealthFile.addExportDeclaration({
  namedExports: fnsToExtract,
  moduleSpecifier: "./scripts/api-spoofs.js"
});

project.saveSync();
