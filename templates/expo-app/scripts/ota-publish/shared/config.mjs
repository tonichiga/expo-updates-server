import fs from "node:fs";

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env.ota`);
  }
  return value;
}

export function getExpoAppVersion(appJson) {
  const version = appJson?.expo?.version;
  return typeof version === "string" && version.trim()
    ? version.trim()
    : null;
}

export function loadPublishConfig() {
  const appJson = JSON.parse(fs.readFileSync("app.json", "utf8"));
  const configuredChannel =
    appJson.expo?.updates?.requestHeaders?.["expo-channel-name"];
  const channel = (
    process.env.EXPO_UPDATE_CHANNEL ||
    configuredChannel ||
    ""
  )
    .trim()
    .toLowerCase();

  if (!channel) {
    throw new Error(
      "Set EXPO_UPDATE_CHANNEL in .env.ota or configure expo-channel-name in app.json.",
    );
  }
  if (configuredChannel && configuredChannel !== channel) {
    throw new Error(
      `Channel mismatch: app.json=${configuredChannel}, .env.ota=${channel}`,
    );
  }

  const runtimeVersion =
    appJson.expo.runtimeVersion?.policy === "appVersion"
      ? appJson.expo.version
      : appJson.expo.runtimeVersion;
  if (typeof runtimeVersion !== "string" || !runtimeVersion.trim()) {
    throw new Error("app.json must contain a string runtimeVersion.");
  }

  return {
    appJson,
    appVersion: getExpoAppVersion(appJson),
    channel,
    runtimeVersion: runtimeVersion.trim(),
    bucket: requiredEnv("R2_BUCKET"),
  };
}
