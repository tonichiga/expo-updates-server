import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServedManifestId } from "../manifest/manifest-identity";

type Row = Record<string, unknown>;

const database = vi.hoisted(() => ({
  channels: [] as Row[],
  updates: [] as Row[],
  embeddedUpdates: [] as Row[],
  servedManifests: [] as Row[],
  emergencyRedirects: [] as Row[],
  mappingError: null as string | null,
  mappingReadError: null as string | null,
  mappingWriteBarrier: null as Promise<void> | null,
  mappingWriteStarted: false,
}));
const distributionControl = vi.hoisted(() => ({
  blocked: false,
  error: null as Error | null,
}));

vi.mock("../lib/distribution-control", () => ({
  isOtaDistributionBlocked: vi.fn(async () => {
    if (distributionControl.error) {
      throw distributionControl.error;
    }
    return distributionControl.blocked;
  }),
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
      return {
        execute: async () => {
          if (this.table === "ota_served_manifest_log") {
            database.mappingWriteStarted = true;
            await database.mappingWriteBarrier;
            if (database.mappingError) {
              return { data: null, error: { message: database.mappingError } };
            }
            const existing = database.servedManifests.find(
              (item) => item.served_manifest_id === row.served_manifest_id,
            );
            if (existing) Object.assign(existing, row);
            else database.servedManifests.push(row);
          }
          return { data: row, error: null };
        },
      };
    }

    maybeSingle() {
      if (this.table === "ota_served_manifest_log" && database.mappingReadError) {
        return Promise.resolve({ data: null, error: { message: database.mappingReadError } });
      }
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
      rpc: async (name: string, args: Record<string, string | null>) => {
        if (name !== "ota_latest_eligible_update") throw new Error(name);
        const rows = database.updates.filter((r) => r.runtime_version === args.p_runtime && r.channel === args.p_channel && r.platform === args.p_platform && r.is_active &&
          (r.audience_mode === 'all' || (r.audience_mode === 'devices' && ((r.audience_installation_ids as string[] || []).includes(args.p_installation || '') || (r.audience_device_ids as string[] || []).includes(args.p_device || '')))));
        rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return { data: rows.slice(0, 1), error: null };
      },
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
    audience_mode: "all",
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

function seedCurrentUpdate() {
  database.channels.push({
    latest_update_id: selectedUpdateId,
    active_update_id: null,
    served_manifest_id: servedManifestId,
    served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
    runtime_version: "1.0.0",
    channel: "production",
    platform: "android",
  });
  database.updates.push(makeUpdate());
}

describe("GET /api/manifest", () => {
  beforeEach(() => {
    vi.resetModules();
    database.channels = [];
    database.updates = [];
    database.embeddedUpdates = [];
    database.servedManifests = [];
    database.emergencyRedirects = [];
    database.mappingError = null;
    database.mappingReadError = null;
    database.mappingWriteBarrier = null;
    database.mappingWriteStarted = false;
    distributionControl.blocked = false;
    distributionControl.error = null;
  });

  it("does not reuse a fallback manifest ID when its draft target becomes active", async () => {
    database.channels.push({
      latest_update_id: selectedUpdateId,
      active_update_id: null,
      served_manifest_id: servedManifestId,
      served_manifest_changed_at: "2026-08-28T09:00:00.000Z",
      runtime_version: "1.0.0",
      channel: "production",
      platform: "android",
    });
    const draft = makeUpdate({ is_active: false });
    const stable = makeUpdate({
      update_id: previousUpdateId,
      created_at: "2026-08-27T08:00:00.000Z",
    });
    database.updates.push(draft, stable);
    // Warm the old implementation's table-detection cache with a known ID.
    database.servedManifests.push({
      served_manifest_id: previousServedManifestId,
      update_id: previousUpdateId,
    });
    await requestManifest(makeRequest({
      "expo-current-update-id": previousServedManifestId,
    }));

    const first = await requestManifest(makeRequest());
    const fallbackId = (await first.text()).match(/"id":"([^"]+)"/)?.[1];
    expect(fallbackId).toBeTruthy();
    expect(database.servedManifests.find(
      (row) => row.served_manifest_id === fallbackId,
    )?.update_id).toBe(previousUpdateId);

    // Even a stale channel snapshot must not give two artifacts the same ID.
    draft.is_active = true;
    stable.is_active = false;
    const second = await requestManifest(makeRequest({
      "expo-current-update-id": fallbackId!,
    }));
    const body = await second.text();
    expect(body).toContain('"launchAsset"');
    expect(body).not.toContain(`"id":"${fallbackId}"`);
    expect(database.servedManifests.find(
      (row) => row.served_manifest_id === fallbackId,
    )?.update_id).toBe(previousUpdateId);
  });

  it("serves the same identity on cold workers and concurrent repeated requests", async () => {
    seedCurrentUpdate();
    const first = await (await requestManifest(makeRequest())).text();
    const id = first.match(/"id":"([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    vi.resetModules();
    const responses = await Promise.all([
      requestManifest(makeRequest()),
      requestManifest(makeRequest()),
    ]);
    for (const response of responses) {
      expect(await response.text()).toContain(`"id":"${id}"`);
    }
    expect(database.servedManifests).toHaveLength(1);
  });

  it("waits for the mapping write before completing a manifest response", async () => {
    seedCurrentUpdate();
    let release!: () => void;
    database.mappingWriteBarrier = new Promise<void>((resolve) => { release = resolve; });
    let completed = false;
    const pending = requestManifest(makeRequest()).then((response) => {
      completed = true;
      return response;
    });
    try {
      await vi.waitFor(() => expect(database.mappingWriteStarted).toBe(true));
      expect(completed).toBe(false);
      expect(database.servedManifests).toHaveLength(0);
    } finally {
      release();
    }
    expect((await pending).status).toBe(200);
    expect(database.servedManifests).toHaveLength(1);
  });

  it.each([
    'relation "ota_served_manifest_log" does not exist',
    "database unavailable",
    "OTA_MANIFEST_IDENTITY_CONFLICT",
  ])("does not deliver a manifest if the mapping cannot be recorded: %s", async (error) => {
    seedCurrentUpdate();
    database.mappingError = error;
    const response = await requestManifest(makeRequest());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('"launchAsset"');
    expect(database.servedManifests).toHaveLength(0);
    // A recovered database must be usable without restarting the worker.
    database.mappingError = null;
    expect((await requestManifest(makeRequest())).status).toBe(200);
  });

  it("fails the request on a mapping lookup error and recovers on the next request", async () => {
    seedCurrentUpdate();
    database.mappingReadError = "database unavailable";
    const request = () => makeRequest({ "expo-current-update-id": previousServedManifestId });
    const response = await requestManifest(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('"launchAsset"');
    expect(database.mappingWriteStarted).toBe(false);
    database.mappingReadError = null;
    expect((await requestManifest(request())).status).toBe(200);
  });

  it("uses the newer activation epoch timestamp for the newly activated artifact", async () => {
    seedCurrentUpdate();
    const draft = database.updates[0];
    draft.is_active = false;
    const stable = makeUpdate({
      update_id: previousUpdateId,
      created_at: "2026-08-27T08:00:00.000Z",
    });
    database.updates.push(stable);
    const fallback = await (await requestManifest(makeRequest())).text();
    const fallbackId = fallback.match(/"id":"([^"]+)"/)?.[1];
    const fallbackDate = fallback.match(/"createdAt":"([^"]+)"/)?.[1];
    expect(fallbackId).toBeTruthy();
    expect(fallbackDate).toBeTruthy();
    draft.is_active = true;
    stable.is_active = false;
    // The SQL integration script separately exercises the activation trigger.
    database.channels[0].served_manifest_id = previousServedManifestId;
    database.channels[0].served_manifest_changed_at = "2026-08-28T09:00:00.001Z";
    const activated = await (await requestManifest(makeRequest({
      "expo-current-update-id": fallbackId!,
    }))).text();
    const activatedDate = activated.match(/"createdAt":"([^"]+)"/)?.[1];
    expect(activated).toContain('"launchAsset"');
    expect(Date.parse(activatedDate!)).toBeGreaterThan(Date.parse(fallbackDate!));
  });

  it.each([selectedUpdateId, previousServedManifestId])(
    "does not redownload an artifact already running under legacy ID %s",
    async (id) => {
      seedCurrentUpdate();
      database.servedManifests.push({
        served_manifest_id: previousServedManifestId,
        update_id: selectedUpdateId,
      });
      const response = await requestManifest(makeRequest({ "expo-current-update-id": id }));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"type":"noUpdateAvailable"');
      expect(database.mappingWriteStarted).toBe(false);
    },
  );

  it("returns signed noUpdateAvailable before redirect or update selection when globally blocked", async () => {
    distributionControl.blocked = true;
    vi.stubEnv(
      "CODE_SIGNING_PRIVATE_KEY_PATH",
      `${process.cwd()}/src/server/cert/codeSigningPrivateKey.pem`,
    );
    database.emergencyRedirects.push({
      id: "redirect-id",
      enabled: true,
      embedded_update_id: previousUpdateId,
      runtime_version: "1.0.0",
      platform: "android",
      from_channel: "production",
      to_channel: "recovery",
      target_mode: "follow",
    });
    database.channels.push({
      runtime_version: "1.0.0",
      channel: "recovery",
      platform: "android",
      latest_update_id: selectedUpdateId,
    });

    const response = await requestManifest(
      makeRequest({
        "expo-embedded-update-id": previousUpdateId,
        "expo-expect-signature": "sig, keyid=main",
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('{"type":"noUpdateAvailable"}');
    expect(body).toContain('expo-signature: sig="');
    expect(body).not.toContain(selectedUpdateId);
  });

  it("fails closed with noUpdateAvailable when global state cannot be read", async () => {
    distributionControl.error = new Error("database unavailable");

    const response = await requestManifest(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      '{"type":"noUpdateAvailable"}',
    );
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
    vi.stubEnv("OTA_CDN_BASE_URL", "https://storage-cdn.example.com");
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
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toContain(`"id":"${createServedManifestId(servedManifestId, selectedUpdateId)}"`);
    expect(body).toContain('"createdAt":"2026-08-28T09:00:00.000Z"');
    expect(body).toContain('"runtimeVersion":"1.0.0"');
    expect(body).toContain(
      '"updatePolicy":{"schemaVersion":1,"policyVersion":1,"delivery":"manual"}',
    );
    expect(body).toContain(
      "https://updates.example.com/api/assets?runtimeVersion=1.0.0",
    );
    expect(body).not.toContain("storage-cdn.example.com");
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
    expect(body).toContain(`"id":"${createServedManifestId(servedManifestId, previousUpdateId)}"`);
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
    expect(body).toContain('"metadata":{"channel":"production"}');
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
    expect(body).toContain('"metadata":{"channel":"production"}');
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
  it("serves a targeted release only to its device; anonymous and other devices receive public fallback", async () => {
    seedCurrentUpdate();
    Object.assign(database.updates[0], { audience_mode: 'devices', audience_device_ids: ['a'.repeat(64)], delivery_mode: 'background', guard_action: 'force-update' });
    database.updates.push(makeUpdate({ update_id: previousUpdateId, created_at: '2026-08-27T08:00:00Z' }));
    for (const extra of ['', 'device_id="' + 'b'.repeat(64) + '"', 'device_id=invalid']) {
      const response = await requestManifest(makeRequest({ 'expo-extra-params': extra }));
      expect(await response.text()).toContain(createServedManifestId(servedManifestId, previousUpdateId));
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    const response = await requestManifest(makeRequest({ 'expo-extra-params': 'device_id="' + 'a'.repeat(64) + '"' }));
    expect(await response.text()).toContain(createServedManifestId(servedManifestId, selectedUpdateId));
  });
  it("fails closed for a private-only release and accepts a matching installation", async () => {
    seedCurrentUpdate();
    Object.assign(database.updates[0], { audience_mode: 'devices', audience_installation_ids: [previousUpdateId] });
    expect(await (await requestManifest(makeRequest())).text()).toContain('noUpdateAvailable');
    expect(await (await requestManifest(makeRequest({ 'expo-extra-params': `installation_id="${previousUpdateId}"` }))).text()).toContain('"launchAsset"');
  });
  it("does not serve a cross-runtime pointed artifact even to a matching target", async () => {
    seedCurrentUpdate(); database.updates[0].runtime_version = 'another-runtime';
    expect(await (await requestManifest(makeRequest())).text()).toContain('noUpdateAvailable');
  });
  it("keeps an explicit public rollback ahead of newer targeted releases", async () => {
    seedCurrentUpdate();
    database.channels[0].active_update_id = previousUpdateId;
    database.updates.push(makeUpdate({ update_id: previousUpdateId, created_at: '2026-08-27T08:00:00Z' }));
    Object.assign(database.updates[0], { audience_mode: 'devices', audience_device_ids: ['a'.repeat(64)] });
    const body = await (await requestManifest(makeRequest({ 'expo-extra-params': 'device_id="' + 'a'.repeat(64) + '"' }))).text();
    expect(body).toContain(createServedManifestId(servedManifestId, previousUpdateId));
  });

  it("does not grant rollback downgrade privileges to a device outside its audience", async () => {
    seedCurrentUpdate();
    database.channels[0].active_update_id = previousUpdateId;
    database.updates.push(makeUpdate({ update_id: previousUpdateId, created_at: '2026-08-27T08:00:00Z', audience_mode: 'devices', audience_device_ids: ['a'.repeat(64)] }));
    const current = '55555555-5555-4555-8555-555555555555';
    database.updates.push(makeUpdate({ update_id: current, created_at: '2026-08-29T08:00:00Z', is_active: false }));
    const outside = await requestManifest(makeRequest({ 'expo-current-update-id': current }));
    expect(await outside.text()).toContain('noUpdateAvailable');
    const selected = await requestManifest(makeRequest({ 'expo-current-update-id': current, 'expo-extra-params': 'device_id="' + 'a'.repeat(64) + '"' }));
    expect(await selected.text()).toContain(createServedManifestId(servedManifestId, previousUpdateId));
  });

});
