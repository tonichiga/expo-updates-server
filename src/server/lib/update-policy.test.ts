import { describe, expect, it, vi } from "vitest";
import {
  createManifestUpdatePolicy,
  validateUpdatePolicy,
} from "./update-policy";

describe("simple update policy", () => {
  it("validates and directly projects an unconditional Guard", () => {
    const guard = {
      action: "require-confirmation",
      payload: { message: "Ready" },
    };
    expect(
      createManifestUpdatePolicy({
        delivery: "background",
        guard,
        policyVersion: 7,
      }),
    ).toEqual({
      schemaVersion: 1,
      policyVersion: 7,
      delivery: "background",
      guard,
    });
  });

  it.each([null, { action: "" }, { action: "   ", payload: null }])(
    "omits Guard for %j",
    (guard) => {
      expect(
        createManifestUpdatePolicy({
          delivery: "manual",
          guard,
          policyVersion: 1,
        }),
      ).toEqual({
        schemaVersion: 1,
        policyVersion: 1,
        delivery: "manual",
      });
    },
  );

  it("rejects payload without an action", () => {
    expect(() =>
      validateUpdatePolicy({
        delivery: "manual",
        guard: { action: "", payload: { invalid: true } },
      }),
    ).toThrow(/payload.*absent/);
  });

  it.each([" action", "action ", "bad\naction", "x".repeat(101)])(
    "rejects invalid action %j",
    (action) => {
      expect(() =>
        validateUpdatePolicy({
          delivery: "manual",
          guard: { action },
        }),
      ).toThrow(/trimmed.*1-100.*control/);
    },
  );

  it("enforces payload depth and byte limits", () => {
    let deep: unknown = "value";
    for (let index = 0; index < 12; index += 1) deep = { deep };
    expect(() =>
      validateUpdatePolicy({
        delivery: "manual",
        guard: { action: "action", payload: deep },
      }),
    ).toThrow(/depth/);
    expect(() =>
      validateUpdatePolicy({
        delivery: "manual",
        guard: { action: "action", payload: "x".repeat(17 * 1024) },
      }),
    ).toThrow(/16384/);
  });

  it("falls back safely for corrupt persisted policy", () => {
    const onCorrupt = vi.fn();
    expect(
      createManifestUpdatePolicy({
        delivery: "invalid",
        guard: null,
        policyVersion: 3,
        onCorrupt,
      }),
    ).toEqual({
      schemaVersion: 1,
      policyVersion: 3,
      delivery: "manual",
    });
    expect(onCorrupt).toHaveBeenCalledOnce();
  });
});
