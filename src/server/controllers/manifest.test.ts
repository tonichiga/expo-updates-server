import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const database = vi.hoisted(() => ({
  channels: [] as Row[],
  updates: [] as Row[],
  embeddedUpdates: [] as Row[],
  servedManifests: [] as Row[],
  emergencyRedirects: [] as Row[],
}));

vi.mock("../lib/supabase.js", () => {
  class Query {
    private filters: Array<{ column: string; value: unknown }> = [];

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ column, value });
      return this;
    }

    order() {
      return this;
    }

    limit() {
      return this;
    }

    upsert(row: Row) {
      if (this.table === "ota_served_manifest_log") {
        database.servedManifests.push(row);
      }
      return Promise.resolve({ data: row, error: null });
    }

    maybeSingle() {
      const rowsByTable: Record<string, Row[]> = {
        ota_update_channels: database.channels,
        ota_updates: database.updates,
        ota_embedded_updates: database.embeddedUpdates,
        ota_served_manifest_log: database.servedManifests,
        ota_emergency_redirects: database.emergencyRedirects,
      };
      const rows = rowsByTable[this.table] || [];
      const data =
        rows.find((row) =>
          this.filters.every(({ column, value }) => row[column] === value),
        ) || null;
      return Promise.resolve({ data, error: null });
    }
  }

  return {
    supabase: {
      from(table: string) {
        return new Query(table);
      },
    },
  };
});

const selectedUpdateId = "11111111-1111-4111-8111-111111111111";
const previousUpdateId = "22222222-2222-4222-8222-222222222222";
const servedManifestId = "33333333-3333-4333-8333-333333333333";
const previousServedManifestId = "44444444-4444-4444-8444-444444444444";

function makeUpdate(overrides: Row = {}): Row {
  return {
    update_id: selectedUpdateId,
    build_id: selectedUpdateId,
    runtime_version: "1.0.0",
    channel: "production",
    platform: "android",
    created_at: "2026-08-28T08:00:00.000Z",
    created_at_path: "2026-08-28T08-00-00.000Z",
    storage_base_path: "1.0.0/android/production/update",
    is_active: true,
    delivery_mode: "manual",
    guard_action: null,
    guard_payload: null,
    policy_version: 1,
    policy_published_at: "2026-08-28T08:00:00.000Z",
    manifest: {
      runtimeVersion: "1.0.0",
      assets: [
        {
          hash: "asset-hash",
          key: "asset-key",
          path: "assets/icon.png",
          fileExtension: ".png",
          contentType: "image/png",
        },
      ],
      launchAsset: {
        hash: "bundle-hash",
        key: "bundle-key",
        path: "bundles/android.js",
        fileExtension: ".js",
        contentType: "application/javascript",
      },
      extra: {
        expoClient: {
          name: "Example",
          slug: "example",
          version: "2.1.0",
        },
      },
    },
    ...overrides,
  };
}

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://updates.example.com/api/manifest", {
    headers: {
      "expo-protocol-version": "1",
      "expo-platform": "android",
      "expo-runtime-version": "1.0.0",
      "expo-channel-name": "production",
      ...headers,
    },
  });
}

async function requestManifest(request: NextRequest) {
  const { default: manifestController } = await import("./manifest");
  return manifestController(request);
}

describe("GET /api/manifest", () => {
  beforeEach(() => {
    vi.resetModules();
    database.channels = [];
    database.updates = [];
    database.embeddedUpdates = [];
    database.servedManifests = [];
    database.emergencyRedirects = [];
  });

  it("rejects unsupported platforms", async () => {
    const response = await requestManifest(
      makeRequest({ "expo-platform": "web" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported platform. Expected either ios or android.",
    });
  });

  it("returns a noUpdateAvailable directive when the channel has no update", async () => {
    const response = await requestManifest(makeRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("expo-protocol-version")).toBe("1");
    expect(response.headers.get("content-type")).toContain("multipart/mixed");
    expect(body).toContain('{"type":"noUpdateAvailable"}');
  });

  it("returns the selected update as an Expo multipart manifest", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-27T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate(),
      makeUpdate({
        update_id: previousUpdateId,
        build_id: previousUpdateId,
        created_at: "2026-08-27T08:00:00.000Z",
      }),
    );
    database.servedManifests.push({
      served_manifest_id: previousServedManifestId,
      update_id: previousUpdateId,
    });

    const response = await requestManifest(
      makeRequest({ "expo-current-update-id": previousServedManifestId }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
    expect(body).toContain(`"id":"${servedManifestId}"`);
    expect(body).toContain('"createdAt":"2026-08-28T09:00:00.000Z"');
    expect(body).toContain('"runtimeVersion":"1.0.0"');
    expect(body).toContain(
      '"updatePolicy":{"schemaVersion":1,"policyVersion":1,"delivery":"manual"}',
    );
    expect(body).toContain(
      "https://updates.example.com/api/assets?runtimeVersion=1.0.0",
    );
    expect(body).toContain('"key":"bundle-key"');
  });

  it("serves the configured unconditional Guard without mutating source", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    const update = makeUpdate({
      delivery_mode: "background",
      policy_version: 7,
      guard_action: "require-confirmation",
      guard_payload: { message: "Ready" },
    });
    const sourceManifest = structuredClone(update.manifest);
    database.updates.push(update);

    const response = await requestManifest(makeRequest());
    const body = await response.text();

    expect(body).toContain(
      '"updatePolicy":{"schemaVersion":1,"policyVersion":7,"delivery":"background","guard":{"action":"require-confirmation","payload":{"message":"Ready"}}}',
    );
    expect(update.manifest).toEqual(sourceManifest);
    expect(
      (update.manifest as Record<string, unknown>).extra,
    ).not.toHaveProperty("updatePolicy");
  });

  it("does not vary the configured Guard by request context", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate({
        guard_action: "unconditional-action",
      }),
      makeUpdate({
        update_id: previousUpdateId,
        build_id: previousUpdateId,
        created_at: "2026-08-27T08:00:00.000Z",
      }),
    );
    database.servedManifests.push({
      served_manifest_id: previousServedManifestId,
      update_id: previousUpdateId,
    });

    const body = await (
      await requestManifest(
        makeRequest({ "expo-current-update-id": previousServedManifestId }),
      )
    ).text();

    expect(body).toContain('"guard":{"action":"unconditional-action"}');
  });

  it("omits Guard when none is configured", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate({
        delivery_mode: "background",
        policy_version: 2,
        guard_action: null,
        guard_payload: null,
      }),
    );

    const body = await (await requestManifest(makeRequest())).text();
    expect(body).toContain(
      '"updatePolicy":{"schemaVersion":1,"policyVersion":2,"delivery":"background"}',
    );
    expect(body).not.toContain('"guard"');
  });

  it("logs corrupt persisted policy and continues with manual defaults", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate({
        delivery_mode: "background",
        policy_version: 9,
        guard_action: " invalid ",
        guard_payload: null,
      }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await requestManifest(makeRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      '"updatePolicy":{"schemaVersion":1,"policyVersion":9,"delivery":"manual"}',
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Corrupt OTA update policy"),
    );
    consoleError.mockRestore();
  });

  it("returns no update when the device already runs the channel target", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(makeUpdate());

    const response = await requestManifest(
      makeRequest({ "expo-current-update-id": selectedUpdateId }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('{"type":"noUpdateAvailable"}');
    expect(body).not.toContain('"launchAsset"');
  });

  it("trusts a newer registered app version when a cached APK rebuild reuses the embedded ID and stale timestamp", async () => {
    const embeddedUpdateId = "55555555-5555-4555-8555-555555555555";
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.1.20",
      channel: "development",
      platform: "android",
    });
    const candidateUpdate = makeUpdate({
      runtime_version: "1.1.20",
      channel: "development",
      created_at: "2026-08-28T08:00:00.000Z",
    });
    (
      candidateUpdate.manifest as {
        extra: { expoClient: { version: string } };
      }
    ).extra.expoClient.version = "1.7.10";
    database.updates.push(candidateUpdate);
    database.embeddedUpdates.push({
      embedded_update_id: embeddedUpdateId,
      app_version: "1.7.11",
      created_at: "2026-08-27T08:00:00.000Z",
      channel: "production",
      platform: "android",
    });
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    const response = await requestManifest(
      makeRequest({
        "expo-runtime-version": "1.1.20",
        "expo-channel-name": "development",
        "expo-embedded-update-id": embeddedUpdateId,
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('{"type":"noUpdateAvailable"}');
    expect(body).not.toContain('"launchAsset"');
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining("blockingReason=app-version"),
    );
    consoleLog.mockRestore();
  });

  it("derives a current OTA baseline app version from the manifest root", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.1.20",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate({
        runtime_version: "1.1.20",
        manifest: {
          expoClient: { version: "1.7.10" },
          launchAsset: {
            hash: "bundle-hash",
            key: "bundle-key",
            path: "bundles/android.js",
          },
        },
      }),
      makeUpdate({
        update_id: previousUpdateId,
        build_id: previousUpdateId,
        runtime_version: "1.1.20",
        channel: "beta",
        created_at: "2026-08-27T08:00:00.000Z",
        manifest: { expoClient: { version: "1.7.11" } },
      }),
    );

    const body = await (
      await requestManifest(
        makeRequest({
          "expo-runtime-version": "1.1.20",
          "expo-current-update-id": previousUpdateId,
        }),
      )
    ).text();

    expect(body).toContain('{"type":"noUpdateAvailable"}');
    expect(body).not.toContain('"launchAsset"');
  });

  it.each([
    ["equal", "2.1.0"],
    ["unparseable", "release-two"],
    ["missing", null],
  ])(
    "preserves timestamp protection when app versions are %s",
    async (_case, appVersion) => {
      const embeddedUpdateId = "66666666-6666-4666-8666-666666666666";
      database.channels.push({
        latest_update_id: selectedUpdateId,
        active_update_id: null,
        active_changed_at: "2026-08-28T09:00:00.000Z",
        served_manifest_id: servedManifestId,
        served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
        runtime_version: "1.0.0",
        channel: "production",
        platform: "android",
      });
      database.updates.push(makeUpdate());
      database.embeddedUpdates.push({
        embedded_update_id: embeddedUpdateId,
        app_version: appVersion,
        created_at: "2026-08-29T08:00:00.000Z",
        channel: "production",
        platform: "android",
      });

      const body = await (
        await requestManifest(
          makeRequest({ "expo-embedded-update-id": embeddedUpdateId }),
        )
      ).text();

      expect(body).toContain('{"type":"noUpdateAvailable"}');
      expect(body).not.toContain('"launchAsset"');
    },
  );

  it("serves selected app version 2.1.0 when installed 2.0.0 has a newer timestamp", async () => {
    const embeddedUpdateId = "88888888-8888-4888-8888-888888888888";
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(makeUpdate());
    database.embeddedUpdates.push({
      embedded_update_id: embeddedUpdateId,
      app_version: "2.0.0",
      created_at: "2026-08-29T08:00:00.000Z",
      channel: "production",
      platform: "android",
    });

    const body = await (
      await requestManifest(
        makeRequest({ "expo-embedded-update-id": embeddedUpdateId }),
      )
    ).text();

    expect(body).toContain('"launchAsset"');
  });

  it("does not apply version or date protection across platforms", async () => {
    const embeddedUpdateId = "77777777-7777-4777-8777-777777777777";
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T09:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(makeUpdate());
    database.embeddedUpdates.push({
      embedded_update_id: embeddedUpdateId,
      app_version: "9.0.0",
      created_at: "2026-08-29T08:00:00.000Z",
      channel: "production",
      platform: "ios",
    });

    const body = await (
      await requestManifest(
        makeRequest({ "expo-embedded-update-id": embeddedUpdateId }),
      )
    ).text();

    expect(body).toContain('"launchAsset"');
  });

  it("serves an older app version when rollback mode is enabled", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: previousUpdateId,
      active_changed_at: "2026-08-28T10:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T10:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    const latestUpdate = makeUpdate();
    (
      latestUpdate.manifest as {
        extra: { expoClient: { version: string } };
      }
    ).extra.expoClient.version = "2.2.0";
    database.updates.push(
      latestUpdate,
      makeUpdate({
        update_id: previousUpdateId,
        build_id: previousUpdateId,
        created_at: "2026-08-27T08:00:00.000Z",
        storage_base_path: "1.0.0/android/production/previous",
      }),
    );

    const response = await requestManifest(
      makeRequest({ "expo-current-update-id": selectedUpdateId }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(`"id":"${previousUpdateId}"`);
    expect(body).toContain(`updateId=${previousUpdateId}`);
    expect(body).toContain('"launchAsset"');
  });

  it("redirects the affected embedded build to its emergency channel", async () => {
    const recoveryUpdateId = "78947abc-8750-4d44-b6ab-53398ff6e4af";
    database.emergencyRedirects.push({
      id: "88888888-8888-4888-8888-888888888888",
      name: "Android production recovery",
      enabled: true,
      embedded_update_id: "35c793d0-7d0a-409e-83cf-ffd4e5004e9d",
      runtime_version: "1.1.20",
      platform: "android",
      from_channel: "development",
      to_channel: "production",
      target_mode: "follow",
      expected_update_id: recoveryUpdateId,
      created_at: "2026-08-28T10:00:00.000Z",
      modified_at: "2026-08-28T10:00:00.000Z",
    });
    database.channels.push({
      latest_update_id: recoveryUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T10:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T10:00:00.000Z",
      runtime_version: "1.1.20",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate({
        update_id: recoveryUpdateId,
        build_id: recoveryUpdateId,
        runtime_version: "1.1.20",
        channel: "production",
      }),
    );

    const response = await requestManifest(
      makeRequest({
        "expo-runtime-version": "1.1.20",
        "expo-channel-name": "development",
        "expo-embedded-update-id": "35c793d0-7d0a-409e-83cf-ffd4e5004e9d",
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(`updateId=${recoveryUpdateId}`);
    expect(body).toContain("channel=production");
  });

  it("applies an emergency redirect stored in the database", async () => {
    const embeddedUpdateId = "55555555-5555-4555-8555-555555555555";
    const recoveryUpdateId = "66666666-6666-4666-8666-666666666666";
    database.emergencyRedirects.push({
      id: "77777777-7777-4777-8777-777777777777",
      name: "Android beta recovery",
      enabled: true,
      embedded_update_id: embeddedUpdateId,
      runtime_version: "2.0.0",
      platform: "android",
      from_channel: "beta",
      to_channel: "production",
      target_mode: "pinned",
      expected_update_id: recoveryUpdateId,
      created_at: "2026-08-28T10:00:00.000Z",
      modified_at: "2026-08-28T10:00:00.000Z",
    });
    database.channels.push({
      latest_update_id: recoveryUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T10:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T10:00:00.000Z",
      runtime_version: "2.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate({
        update_id: recoveryUpdateId,
        build_id: recoveryUpdateId,
        runtime_version: "2.0.0",
        channel: "production",
      }),
    );

    const response = await requestManifest(
      makeRequest({
        "expo-runtime-version": "2.0.0",
        "expo-channel-name": "beta",
        "expo-embedded-update-id": embeddedUpdateId,
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(`updateId=${recoveryUpdateId}`);
    expect(body).toContain("channel=production");
  });

  it("returns no update when a pinned redirect target does not match", async () => {
    const embeddedUpdateId = "99999999-9999-4999-8999-999999999999";
    database.emergencyRedirects.push({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Pinned recovery",
      enabled: true,
      embedded_update_id: embeddedUpdateId,
      runtime_version: "3.0.0",
      platform: "android",
      from_channel: "beta",
      to_channel: "production",
      target_mode: "pinned",
      expected_update_id: previousUpdateId,
      created_at: "2026-08-28T10:00:00.000Z",
      modified_at: "2026-08-28T10:00:00.000Z",
    });
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      active_changed_at: "2026-08-28T10:00:00.000Z",
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T10:00:00.000Z",
      runtime_version: "3.0.0",
      channel: "production",
      platform: "android",
    });
    database.updates.push(
      makeUpdate({
        runtime_version: "3.0.0",
        channel: "production",
      }),
    );

    const response = await requestManifest(
      makeRequest({
        "expo-runtime-version": "3.0.0",
        "expo-channel-name": "beta",
        "expo-embedded-update-id": embeddedUpdateId,
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('{"type":"noUpdateAvailable"}');
    expect(body).not.toContain('"launchAsset"');
  });
});
