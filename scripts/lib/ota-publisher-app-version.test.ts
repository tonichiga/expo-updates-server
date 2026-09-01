import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const configUrl = pathToFileURL(
  path.resolve("templates/expo-app/scripts/ota-publish/shared/config.mjs"),
).href;
const databaseClientUrl = pathToFileURL(
  path.resolve(
    "templates/expo-app/scripts/ota-publish/api/database-client.mjs",
  ),
).href;

describe("OTA publisher app version", () => {
  it("extracts expo.version from the trusted app config", async () => {
    const { getExpoAppVersion } = await import(configUrl);

    expect(
      getExpoAppVersion({ expo: { version: " 2.4.1 " } }),
    ).toBe("2.4.1");
    expect(getExpoAppVersion({ expo: {} })).toBeNull();
  });

  it("writes the extracted app version to the update row", async () => {
    const query = vi.fn(async (...args: unknown[]) => {
      void args;
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };
    const { writeDatabaseRecords } = await import(databaseClientUrl);

    await writeDatabaseRecords(
      pool,
      {
        id: "22222222-2222-4222-8222-222222222222",
        appVersion: "2.4.1",
        runtimeVersion: "runtime-1",
        channel: "production",
        platform: "ios",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdAtPath: "2026/01/01/000000",
        storageBucket: "updates",
        storageBasePath: "runtime-1/ios/update",
        assets: [{ path: "asset" }],
        launchAsset: { path: "bundle.js" },
        comment: "Publish",
      },
      {
        runtimeVersion: "runtime-1",
        channel: "production",
        platform: "ios",
        updateId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdAtPath: "2026/01/01/000000",
      },
    );

    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO ota_updates"),
    );
    expect(insertCall?.[0]).toContain("app_version");
    expect(insertCall?.[1]?.[1]).toBe("2.4.1");
    expect(release).toHaveBeenCalledOnce();
  });
});
