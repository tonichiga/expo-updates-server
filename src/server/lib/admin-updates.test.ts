import { describe, expect, it } from "vitest";
import {
  assertExpectedPolicyVersion,
  mapRowToRecord,
  OtaUpdateRow,
  UpdatePolicyConflictError,
} from "./admin-updates";
import { UpdatePolicyValidationError } from "./update-policy";

function makeRow(manifest: Record<string, unknown> = {}): OtaUpdateRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    update_id: "22222222-2222-4222-8222-222222222222",
    build_id: "33333333-3333-4333-8333-333333333333",
    comment: null,
    runtime_version: "runtime-1",
    channel: "production",
    platform: "ios",
    created_at: "2026-01-01T00:00:00.000Z",
    created_at_path: "2026/01/01/000000",
    storage_bucket: "updates",
    storage_base_path: "runtime-1/ios/update",
    is_active: true,
    updated_at: null,
    disabled_at: null,
    assets_count: 2,
    launch_asset_path: "bundle.js",
    rolled_back_from_update_id: null,
    delivery_mode: "manual",
    guard_rules: [],
    policy_version: 1,
    policy_published_at: "2026-01-01T00:00:00.000Z",
    manifest,
    inserted_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("OTA admin update mapping", () => {
  it("requires expectedPolicyVersion at the service boundary", () => {
    expect(() => assertExpectedPolicyVersion(undefined)).toThrow(
      UpdatePolicyValidationError,
    );
  });

  it("rejects a stale expectedPolicyVersion at the service boundary", () => {
    expect(() => assertExpectedPolicyVersion(2, 3)).toThrow(
      UpdatePolicyConflictError,
    );
  });

  it("maps expoClient.version from the stored manifest", () => {
    const item = mapRowToRecord(
      makeRow({ expoClient: { version: "2.4.1" } }),
      null,
    );

    expect(item.appVersion).toBe("2.4.1");
    expect(item.runtimeVersion).toBe("runtime-1");
  });

  it("normalizes a non-empty manifest app version", () => {
    const item = mapRowToRecord(
      makeRow({ expoClient: { version: " 2.4.1 " } }),
      null,
    );

    expect(item.appVersion).toBe("2.4.1");
  });

  it("prefers extra.expoClient.version from uploaded manifests", () => {
    const item = mapRowToRecord(
      makeRow({
        expoClient: { version: "1.0.0" },
        extra: { expoClient: { version: "2.4.1" } },
      }),
      null,
    );

    expect(item.appVersion).toBe("2.4.1");
  });

  it.each([
    ["missing expoClient", {}],
    ["missing version", { expoClient: {} }],
    ["blank version", { expoClient: { version: " \t " } }],
    ["non-string version", { expoClient: { version: 241 } }],
    ["malformed expoClient", { expoClient: "invalid" }],
  ])("maps %s to null", (_case, manifest) => {
    expect(mapRowToRecord(makeRow(manifest), null).appVersion).toBeNull();
  });
});
