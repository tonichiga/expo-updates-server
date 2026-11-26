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

it("uses application storage, UUID and SHA-256 without calling default providers", async () => {
  vi.stubGlobal("__DEV__", false);
  const runtime = await import("../src/runtime-core");
  const data = new Map();
  const adapter = {
    storage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value); },
      removeItem: key => { data.delete(key); },
    },
    randomUUID: () => "custom-uuid",
    sha256: value => "hash:" + value,
  };
  runtime.initializeOtaClient({ ...settings, adapter });
  expect(await runtime.getInstallationId()).toBe("custom-uuid");
  expect(await runtime.getDeviceId()).toContain("hash:");
  expect(runtime.getOtaStorage()).toBe(adapter.storage);
  expect(native.getItem).not.toHaveBeenCalled();
  expect(native.digest).not.toHaveBeenCalled();
});

it("preserves pending analytics and postponed updates across a failed storage migration", async () => {
  const { migrateOtaStorage } = await import("../src/migrate-storage");
  const install = "@ota-client/installation-v1";
  const postpone = "@ota-client/postponed-update";
  const old = new Map([[install, '{"sequence":4,"pending":{"eventId":"pending"}}'], [postpone, "update"]]);
  const next = new Map();
  const store = map => ({
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  });
  const destination = store(next);
  await expect(migrateOtaStorage(store(old), { ...destination, setItem() { throw Error("disk"); } })).rejects.toThrow("disk");
  expect(old.size).toBe(2);
  await migrateOtaStorage(store(old), destination);
  expect(JSON.parse(next.get(install)).pending.eventId).toBe("pending");
  expect(next.get(postpone)).toBe("update");
  expect(old.size).toBe(0);
  await migrateOtaStorage(store(old), destination);
  expect(next.size).toBe(2);
});
