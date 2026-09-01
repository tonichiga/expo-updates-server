import { describe, expect, it } from "vitest";
import {
  beginCatalogAttempt,
  filterGuardActionOptions,
  isCurrentCatalogAttempt,
  mergeGuardActionOptions,
  normalizeCreatableGuardAction,
} from "./guard-action-options";

const catalog = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    actionKey: "zeta",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    actionKey: "alpha",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("guard action combobox helpers", () => {
  it("sorts persisted options and filters case-insensitively", () => {
    const options = mergeGuardActionOptions(catalog, []);
    expect(options.map((option) => option.actionKey)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(filterGuardActionOptions(options, "ET")).toEqual([options[1]]);
  });

  it("merges exact out-of-catalog policy values without rewriting", () => {
    const options = mergeGuardActionOptions(catalog, [
      "Alpha",
      "alpha",
      "legacy-action",
    ]);
    expect(options.slice(2)).toEqual([
      { id: null, actionKey: "Alpha", persisted: false },
      { id: null, actionKey: "legacy-action", persisted: false },
    ]);
  });

  it("normalizes only newly created values and validates catalog limits", () => {
    expect(normalizeCreatableGuardAction("  new-action ")).toBe("new-action");
    expect(() => normalizeCreatableGuardAction("bad\tvalue")).toThrow(
      /control characters/,
    );
    expect(() => normalizeCreatableGuardAction("x".repeat(101))).toThrow(
      /between 1 and 100/,
    );
  });

  it("invalidates a stale selected-action catalog attempt", () => {
    const state = { current: 0 };
    const staleAttempt = beginCatalogAttempt(state);
    expect(isCurrentCatalogAttempt(state, staleAttempt)).toBe(true);
    beginCatalogAttempt(state);
    expect(isCurrentCatalogAttempt(state, staleAttempt)).toBe(false);
  });
});
