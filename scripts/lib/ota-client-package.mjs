export const clientPackage = "expo-updates-server-client";
export const clientVersion = "0.2.0";
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

export function clientDependencies(adapter) {
  return adapter ? ["expo-updates", "expo-application", "expo-secure-store"] : nativeClientDependencies;
}

export function bootstrapCode(entry, adapter) {
  return [
    `const otaClient = require('${clientPackage}${adapter ? "/custom" : ""}');`,
    adapter
      ? `otaClient.initializeOtaClient({ ...require('./ota-client/config.json'), adapter: require(${JSON.stringify(adapter)}).otaAdapter });`
      : "otaClient.initializeOtaClient(require('./ota-client/config.json'));",
    "otaClient.start();",
    originalEntryCode(entry),
  ].join("\n");
}
