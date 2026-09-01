import { describe, expect, it } from "vitest";
import {
  compareAppVersions,
  getManifestAppVersion,
} from "./manifest-values";

describe("compareAppVersions", () => {
  it.each([
    ["1.7.11", "1.7.10", 1],
    ["1.10", "1.9", 1],
    ["1.0.0", "1", 0],
    ["1.0.0-beta.2", "1.0.0-beta.11", -1],
    ["1.0.0-beta", "1.0.0", -1],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0+build.2", "1.0.0+build.1", 0],
  ])("compares %s with %s", (left, right, expected) => {
    expect(compareAppVersions(left, right)).toBe(expected);
  });

  it.each([
    ["", "1.0.0"],
    ["version 2", "1.0.0"],
    ["1..2", "1.0.0"],
    ["1.0.0_beta", "1.0.0"],
    ["1.02.0", "1.2.0"],
    ["1.0.0-beta.01", "1.0.0-beta.1"],
    [null, "1.0.0"],
  ])("returns indeterminate for %s and %s", (left, right) => {
    expect(compareAppVersions(left, right)).toBeNull();
  });
});

describe("getManifestAppVersion", () => {
  it("reads the root expoClient version", () => {
    expect(
      getManifestAppVersion({ expoClient: { version: " 1.7.11 " } }),
    ).toBe("1.7.11");
  });

  it("reads the extra expoClient version", () => {
    expect(
      getManifestAppVersion({ extra: { expoClient: { version: "1.7.10" } } }),
    ).toBe("1.7.10");
  });

  it("prefers the extra expoClient version when both are present", () => {
    expect(
      getManifestAppVersion({
        expoClient: { version: "2.0.0" },
        extra: { expoClient: { version: "1.0.0" } },
      }),
    ).toBe("1.0.0");
  });
});
