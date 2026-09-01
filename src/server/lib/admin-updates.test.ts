import { describe, expect, it } from "vitest";
import {
  mapRowToRecord,
  OtaUpdateRow,
} from "./admin-updates";

function makeRow(appVersion?: string | null): OtaUpdateRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    update_id: "22222222-2222-4222-8222-222222222222",
    build_id: "33333333-3333-4333-8333-333333333333",
    app_version: appVersion,
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
    manifest: {},
    inserted_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("OTA admin update mapping", () => {
  it("maps the stored Expo app version independently of runtimeVersion", () => {
    const item = mapRowToRecord(makeRow("2.4.1"), null);

    expect(item.appVersion).toBe("2.4.1");
    expect(item.runtimeVersion).toBe("runtime-1");
  });

  it("maps legacy rows without an app version to null", () => {
    expect(mapRowToRecord(makeRow(), null).appVersion).toBeNull();
  });
});
