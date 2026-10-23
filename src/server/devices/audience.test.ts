import { describe, it, expect } from "vitest";
import {
  readRequestIdentity,
  parseAudience,
  eligibleForAudience,
} from "./audience";
const id = "11111111-1111-4111-8111-111111111111";
describe("audience contract", () => {
  it("reads Expo structured fields with unrelated parameters; ignores malformed identities", () => {
    expect(
      readRequestIdentity(
        new Headers({
          "expo-extra-params": `installation_id="${id}", device_id="${"a".repeat(64)}", other="escaped\\\"value"`,
        }),
      ),
    ).toEqual({ installationId: id, deviceId: "a".repeat(64) });
    expect(
      readRequestIdentity(
        new Headers({ "expo-extra-params": `installation_id=${id}` }),
      ).installationId,
    ).toBeNull();
    expect(
      readRequestIdentity(new Headers({ "expo-extra-params": 'broken="' }))
        .deviceId,
    ).toBeNull();
  });
  it("rejects empty selected audience and unknown mode; missing fields fail closed", () => {
    const base = {
      audience_mode: "devices",
      audience_version: 1,
      audience_installation_ids: [],
      audience_device_ids: [],
    };
    expect(() => parseAudience(base)).toThrow("Select");
    expect(() =>
      parseAudience({ ...base, audience_mode: "surprise" }),
    ).toThrow();
    expect(
      eligibleForAudience({}, { installationId: id, deviceId: null }),
    ).toBe(false);
    expect(
      eligibleForAudience(
        { ...base, audience_mode: "devices", audience_installation_ids: [id] },
        { installationId: id, deviceId: null },
      ),
    ).toBe(true);
  });
});
