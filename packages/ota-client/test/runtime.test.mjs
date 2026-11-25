import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  addListener: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  setExtraParam: vi.fn(),
  digest: vi.fn(async (_algorithm, input) => "sha256(" + input + ")"),
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "background",
    addEventListener: native.addListener,
  },
  Platform: { OS: "android" },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: native.getItem, setItem: native.setItem },
}));
vi.mock("expo-application", () => ({
  applicationId: "com.example.test",
  getAndroidId: () => "android-id",
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "1",
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "fresh-event-id",
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: native.digest,
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-updates", () => ({
  isEnabled: true,
  isEmbeddedLaunch: true,
  isEmergencyLaunch: false,
  runtimeVersion: "1",
  updateId: null,
  manifest: {},
  setExtraParamAsync: native.setExtraParam,
}));

const settings = {
  channel: "test",
  heartbeatUrl: "https://updates.example.org/api/device-heartbeat",
  identityNamespace: "original-namespace",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("OTA SDK bootstrap", () => {
  it("reports missing configuration and lets the caller initialize after a validation error", async () => {
    vi.stubGlobal("__DEV__", true);
    const { start, getInstallationId, getDeviceId, initializeOtaClient } =
      await import("../src/runtime");
    expect(start).toThrow("initializeOtaClient(config)");
    await expect(getInstallationId()).rejects.toThrow(
      "initializeOtaClient(config)",
    );
    expect(() => initializeOtaClient({ ...settings, channel: "" })).toThrow(
      "channel",
    );
    initializeOtaClient(settings);
    start();
    expect(await getInstallationId()).toBeNull();
    expect(await getDeviceId()).toBeNull();
    expect(native.addListener).not.toHaveBeenCalled();
  });

  it("reuses the persisted identity and sequence and registers a single heartbeat listener", async () => {
    vi.stubGlobal("__DEV__", false);
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "accepted" }),
    }));
    vi.stubGlobal("fetch", fetch);
    native.getItem.mockResolvedValue(
      JSON.stringify({
        installationId: "existing-installation",
        sequence: 4,
        pending: null,
      }),
    );
    const { start, getDeviceId, initializeOtaClient } = await import("../src/runtime");
    const config = { ...settings };
    initializeOtaClient(config);
    config.channel = "mutated";
    initializeOtaClient({ ...settings });
    expect(() => initializeOtaClient(config)).toThrow(
      "different configuration",
    );
    start();
    start();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(native.addListener).toHaveBeenCalledOnce();
    expect(native.getItem).toHaveBeenCalledWith("@ota-client/installation-v1");
    expect(native.setExtraParam).toHaveBeenCalledWith(
      "installation_id",
      "existing-installation",
    );
    expect(native.digest).toHaveBeenCalledWith(
      "sha256",
      "ota-device-v1:com.example.test:original-namespace",
    );
    const [url, request] = fetch.mock.calls[0];
    const deviceId = await getDeviceId();
    expect(deviceId).toBeTruthy();
    expect(native.setExtraParam).toHaveBeenCalledWith("device_id", deviceId);
    expect(JSON.parse(request.body).deviceId).toBe(deviceId);
    expect(url).toBe(settings.heartbeatUrl);
    expect(JSON.parse(request.body)).toMatchObject({
      installationId: "existing-installation",
      sequence: 5,
      channel: "test",
    });
  });
});
