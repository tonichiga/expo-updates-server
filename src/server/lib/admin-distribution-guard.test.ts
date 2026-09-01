import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAllowed = vi.hoisted(() => vi.fn());

vi.mock("./distribution-control", () => ({
  assertOtaDistributionAllowed: assertAllowed,
}));

vi.mock("./supabase.js", () => ({
  jsonb: (value: unknown) => value,
  SUPABASE_BUCKET: "updates",
  supabase: {
    from: () => {
      throw new Error("Database access must not happen after blocked guard.");
    },
  },
}));

import {
  promoteLatestByKey,
  rollbackToUpdateByKey,
  setUpdateDisabledByKey,
  updateJsonFileByKey,
} from "./admin-updates";

describe("admin OTA distribution guards", () => {
  beforeEach(() => {
    assertAllowed.mockReset();
    assertAllowed.mockRejectedValue(new Error("blocked"));
  });

  it.each([
    ["rollback", () => rollbackToUpdateByKey("invalid")],
    ["promote", () => promoteLatestByKey("invalid")],
    ["activation", () => setUpdateDisabledByKey("invalid", false)],
    [
      "channel latest",
      () =>
        updateJsonFileByKey("invalid", "channel-latest.json", {
          updateId: "invalid",
        }),
    ],
    [
      "activating update meta",
      () =>
        updateJsonFileByKey("invalid", "update-meta.json", {
          isActive: true,
        }),
    ],
  ])("rejects %s before database mutation", async (_name, operation) => {
    await expect(operation()).rejects.toThrow("blocked");
    expect(assertAllowed).toHaveBeenCalledTimes(1);
  });

  it("does not apply the distribution guard to safe draft JSON changes", async () => {
    await expect(
      updateJsonFileByKey("invalid", "update-info.json", {}),
    ).rejects.toThrow("Invalid update key format");
    expect(assertAllowed).not.toHaveBeenCalled();
  });
});
