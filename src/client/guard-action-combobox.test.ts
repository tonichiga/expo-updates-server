import { describe, expect, it } from "vitest";
import { mergeGuardActionOptions } from "./guard-action-options";
import { isBuiltInAction } from "./policy-draft";

describe("custom action selection", () => {
  it("offers catalog and orphaned action keys, with built-in actions in their own profiles", () => {
    const catalog = [
      { id: "1", actionKey: "ota-force-update", createdAt: "" },
      { id: "2", actionKey: "app-check", createdAt: "" },
    ];
    const custom = mergeGuardActionOptions(catalog, [
      "missing-from-catalog",
      "ota-force-store-update",
    ]).filter((option) => !isBuiltInAction(option.actionKey));
    expect(custom.map((o) => [o.actionKey, o.persisted])).toEqual([
      ["app-check", true],
      ["missing-from-catalog", false],
    ]);
  });
});
