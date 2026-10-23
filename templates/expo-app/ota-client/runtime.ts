import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createDeviceIdentity } from "./device-identity";
import * as Updates from "expo-updates";
import { AppState, Platform } from "react-native";
import { createInstallationClient } from "./controller";
import config from "./config.json";
import { manifestDetails } from "./types";

class HeartbeatError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

const STORAGE_KEY = "@ota-client/installation-v1";
export const enabled = Platform.OS !== "web" && !__DEV__ && Updates.isEnabled;
const resolveDeviceId = createDeviceIdentity({
  platform: Platform.OS,
  scope: `${Application.applicationId}:${config.identityNamespace}`,
  androidId: () => Application.getAndroidId(),
  readSecure: (key) => SecureStore.getItemAsync(key),
  writeSecure: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  uuid: () => Crypto.randomUUID(),
  digest: (value) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
});
let deviceId: string | null = null;
const client = createInstallationClient({
  read: () => AsyncStorage.getItem(STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(STORAGE_KEY, value),
  uuid: () => Crypto.randomUUID(),
  setIdentity: async (id) => {
    await Updates.setExtraParamAsync("installation_id", id);
    // Temporary Keychain failure must not stop installation telemetry or keep a stale identity.
    deviceId = await resolveDeviceId().catch(() => null);
    await Updates.setExtraParamAsync("device_id", deviceId);
  },
  snapshot: () => ({
    ...(deviceId ? { deviceId } : {}),
    platform: Platform.OS,
    channel:
      manifestDetails(Updates.manifest)?.metadata?.channel || config.channel,
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    nativeVersion: Application.nativeApplicationVersion,
    nativeBuild: Application.nativeBuildVersion,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
  }),
  send: async (event) => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await fetch(config.heartbeatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: abort.signal,
      });
      if (!response.ok) {
        const error = new HeartbeatError(
          `Heartbeat HTTP ${response.status}`,
          response.status === 400 || response.status === 409,
        );
        throw error;
      }
      const result = await response.json();
      if (!["accepted", "duplicate", "stale"].includes(result.status))
        throw new Error("Invalid heartbeat response");
    } finally {
      clearTimeout(timeout);
    }
  },
});

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastObservation = 0;
let failures = 0;
let ticking: Promise<void> | undefined;
function schedule() {
  clearTimeout(timer);
  if (AppState.currentState !== "active") return;
  timer = setTimeout(tick, Math.min(60000 * 2 ** failures, 300000));
}
async function performTick() {
  clearTimeout(timer);
  try {
    // Retry the exact durable event before replacing it with a fresh observation.
    try {
      await client.flush();
    } catch (error) {
      if (!(error instanceof HeartbeatError) || !error.permanent) throw error;
    }
    if (Date.now() - lastObservation >= 60000) {
      await client.observe();
      lastObservation = Date.now();
    }
    failures = 0;
  } catch {
    failures = Math.min(failures + 1, 3);
  } finally {
    schedule();
  }
}
function tick() {
  if (ticking) return ticking;
  ticking = performTick().finally(() => {
    ticking = undefined;
  });
  return ticking;
}
export function start() {
  if (started || !enabled) return;
  started = true;
  // Registration of the original application entry never waits for telemetry.
  void client
    .observe()
    .then(() => {
      lastObservation = Date.now();
    })
    .catch(() => undefined)
    .finally(schedule);
  AppState.addEventListener("change", (state) => {
    if (state === "active") void tick();
    else clearTimeout(timer);
  });
}
export async function getInstallationId() {
  if (!enabled) return null;
  return client.ready();
}
export async function getDeviceId() {
  await getInstallationId();
  return deviceId;
}
export async function checkForUpdateAsync() {
  await getInstallationId();
  return Updates.checkForUpdateAsync();
}
export async function fetchUpdateAsync() {
  await getInstallationId();
  return Updates.fetchUpdateAsync();
}
