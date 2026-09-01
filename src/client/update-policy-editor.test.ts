import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./update-policy-editor.tsx", import.meta.url),
  "utf8",
);

describe("simple update policy editor", () => {
  it("contains only the unconditional Guard editor model", () => {
    expect(source).toContain("Guard enabled");
    expect(source).toContain("applies unconditionally");
    expect(source).toContain("Optional custom JSON payload");
    expect(source).not.toMatch(
      /Priority|OR group|AND condition|UpdatePolicyRule|conditions/,
    );
  });

  it("keeps catalog-only creation independent from policy editing", () => {
    expect(source).toContain("canWriteGuardActions ? (");
    expect(source).toContain("Add action to catalog");
    expect(source).toContain(
      "Adds a reusable catalog item without changing this policy.",
    );
    expect(source).toContain("Guard action catalog entries");
    expect(source).toContain("canWriteGuardActions ? (");
  });

  it("retries only the currently selected action", () => {
    expect(source).toContain(
      'persistSelectedAction(policy.guard?.action || "")',
    );
    expect(source).toContain("beginCatalogAttempt(actionAttempt.current)");
    expect(source).toContain("setActionError(\"\")");
  });
});
