import { describe, expect, it } from "vitest";
import { groupVersions } from "./version-groups";
import type { DeviceVersion } from "@/src/server/devices/report-types";
const version = (patch: Partial<DeviceVersion> = {}): DeviceVersion => ({
  app_version: "1.0.0",
  update_id: "ota-1",
  update_label: "This message must not become a version",
  platform: "android",
  channel: "production",
  runtime_version: "runtime-1",
  native_version: "1.0",
  native_build: "1",
  launch_kind: "ota",
  installations: 2,
  ...patch,
});
describe("version adoption groups", () => {
  it("isolates runtime, channel and platform totals", () => {
    const groups = groupVersions([
      version(),
      version({ runtime_version: "runtime-2", installations: 10 }),
      version({ channel: "staging", installations: 5 }),
      version({ platform: "ios", installations: 3 }),
    ]);
    expect(groups.map((g) => g.total).sort((a, b) => a - b)).toEqual([10, 10]);
    const scopes = groups.find((g) => g.runtime === "runtime-1")!.scopes;
    expect(scopes.map((s) => [s.channel, s.platform, s.total])).toEqual([
      ["production", "android", 2],
      ["production", "ios", 3],
      ["staging", "android", 5],
    ]);
  });
  it("merges native builds of one OTA but keeps different OTA IDs with same app version separate", () => {
    const scope = groupVersions([
      version(),
      version({ native_build: "2", installations: 3 }),
      version({ update_id: "ota-2", installations: 4 }),
    ])[0].scopes[0];
    expect(scope.total).toBe(9);
    expect(scope.versions.map((v) => v.installations)).toEqual([5, 4]);
    expect(scope.versions[0]).toMatchObject({
      appVersion: "1.0.0",
      updateId: "ota-1",
      nativeBuilds: ["1.0 (1)", "1.0 (2)"],
    });
    expect(JSON.stringify(scope)).not.toContain("message");
  });
  it("keeps unidentified builds separate and never substitutes native version for missing OTA version", () => {
    const scope = groupVersions([
      version({ app_version: null, update_id: null }),
      version({ app_version: null, update_id: null, native_build: "2" }),
    ])[0].scopes[0];
    expect(scope.versions).toHaveLength(2);
    expect(scope.versions.every((v) => v.appVersion === null)).toBe(true);
    expect(groupVersions([])).toEqual([]);
  });
});
