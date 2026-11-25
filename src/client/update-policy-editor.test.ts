import { describe, expect, it } from "vitest";
import {
  chooseBehavior,
  draftFromPolicy,
  policyFromDraft,
  setStoreLink,
  storePayloadObject,
  validStoreLink,
} from "./policy-draft";
import type { UpdatePolicy } from "./admin-types";

describe("policy editor draft", () => {
  it.each(["manual", "background"] as const)(
    "preserves independent %s delivery with every guard",
    (delivery) => {
      for (const guard of [
        null,
        { action: "ota-force-update", payload: [1, true] },
        {
          action: "ota-force-store-update",
          payload: { iosUrl: "itms-apps://apps.apple.com/id42", custom: 4 },
        },
        { action: "an-unlisted-action", payload: false },
      ]) {
        const saved = { delivery, guard } satisfies Pick<
          UpdatePolicy,
          "delivery" | "guard"
        >;
        expect(policyFromDraft(draftFromPolicy(saved))).toEqual(saved);
      }
    },
  );
  it("switches off the previous guard when choosing background delivery", () => {
    const original = draftFromPolicy({
      delivery: "manual",
      guard: { action: "custom", payload: "keep" },
    });
    expect(policyFromDraft(chooseBehavior(original, "background"))).toEqual({
      delivery: "background",
      guard: null,
    });
    expect(chooseBehavior(original, "custom")).toBe(original);
  });
  it("distinguishes an empty custom guard from invalid JSON", () => {
    const draft = chooseBehavior(
      draftFromPolicy({ delivery: "manual", guard: null }),
      "custom",
    );
    expect(() => policyFromDraft(draft)).toThrow("Select or create");
    expect(() =>
      policyFromDraft({ ...draft, action: "app-action", payload: "{" }),
    ).toThrow("valid JSON");
  });
  it("edits individual store links without dropping custom fields and recognises unsupported structures", () => {
    expect(
      JSON.parse(
        setStoreLink(
          { url: "https://example.com", custom: ["keep"] },
          "iosUrl",
          "itms-apps://apps.apple.com/id42",
        ),
      ),
    ).toEqual({
      url: "https://example.com",
      custom: ["keep"],
      iosUrl: "itms-apps://apps.apple.com/id42",
    });
    for (const payload of ['"legacy"', "[1]", '{"iosUrl":42}', "{"])
      expect(storePayloadObject(payload)).toBeNull();
  });
  it("uses the same platform precedence as the client when validating a store target", () => {
    expect(
      validStoreLink(
        '{"iosUrl":"http://invalid","url":"https://example.com"}',
        "ios",
      ),
    ).toBe(false);
    expect(
      validStoreLink('{"androidUrl":"market://details?id=example"}', "android"),
    ).toBe(true);
    expect(
      validStoreLink('{"url":"https://apps.apple.com/app/id123"}', "ios"),
    ).toBe(true);
    expect(
      validStoreLink(
        '{"iosUrl":"https://apps.apple.com/app/id123","androidUrl":null}',
        "ios",
      ),
    ).toBe(true);
    expect(
      validStoreLink('{"androidUrl":"market://details?id=example"}', "ios"),
    ).toBe(false);
  });
});
