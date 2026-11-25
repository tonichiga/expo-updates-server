export const clientPackage = "expo-updates-server-client";
export const clientVersion = "0.1.0";
export const nativeClientDependencies = [
  "expo-updates",
  "expo-application",
  "expo-crypto",
  "expo-secure-store",
  "@react-native-async-storage/async-storage",
];

export function originalEntryCode(entry) {
  if (entry === "__platform_default__") return "require('./ota-original-entry');";
  if (entry === "__app_fallback__")
    return "require('expo').registerRootComponent(require('./App').default);";
  return `require(${JSON.stringify(entry)});`;
}

export function bootstrapCode(entry) {
  return [
    `const otaClient = require('${clientPackage}');`,
    "otaClient.initializeOtaClient(require('./ota-client/config.json'));",
    "otaClient.start();",
    originalEntryCode(entry),
  ].join("\n");
}
