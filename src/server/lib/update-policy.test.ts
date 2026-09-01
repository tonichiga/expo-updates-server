import { describe, expect, it, vi } from "vitest";
import {
  createManifestUpdatePolicy,
  evaluateUpdatePolicy,
  UpdatePolicyRule,
  validateUpdatePolicy,
} from "./update-policy";

const rule = (
  overrides: Partial<UpdatePolicyRule> = {},
): UpdatePolicyRule => ({
  id: "rule-1",
  enabled: true,
  priority: 10,
  action: "require-confirmation",
  groups: [
    {
      conditions: [
        { field: "platform", operator: "equals", value: "ANDROID" },
        { field: "channel", operator: "in", value: [" Production "] },
      ],
    },
  ],
  ...overrides,
});

describe("update policy", () => {
  it("normalizes values and evaluates AND conditions inside OR groups", () => {
    const policy = validateUpdatePolicy({
      delivery: "background",
      rules: [
        rule({
          groups: [
            {
              conditions: [
                { field: "platform", operator: "equals", value: "ANDROID" },
                { field: "channel", operator: "equals", value: "other" },
              ],
            },
            {
              conditions: [
                { field: "platform", operator: "equals", value: "android" },
                { field: "channel", operator: "equals", value: "PRODUCTION" },
              ],
            },
          ],
        }),
      ],
    });

    expect(
      evaluateUpdatePolicy(policy.rules, {
        platform: "Android",
        channel: "production",
      })?.id,
    ).toBe("rule-1");
  });

  it("uses ascending priority and ignores disabled rules", () => {
    const { rules } = validateUpdatePolicy({
      delivery: "manual",
      rules: [
        rule({ id: "later", priority: 20 }),
        rule({ id: "disabled", priority: 1, enabled: false }),
        rule({ id: "first", priority: 2, action: "first" }),
      ],
    });
    expect(
      evaluateUpdatePolicy(rules, {
        platform: "android",
        channel: "production",
      })?.action,
    ).toBe("first");
  });

  it("does not let negative comparisons match missing fields", () => {
    expect(
      evaluateUpdatePolicy(
        [
          rule({
            groups: [
              {
                conditions: [
                  {
                    field: "appVersion",
                    operator: "notEquals",
                    value: "1.0",
                  },
                ],
              },
            ],
          }),
        ],
        {},
      ),
    ).toBeNull();
  });

  it("rejects duplicate priorities and invalid operator values", () => {
    expect(() =>
      validateUpdatePolicy({
        delivery: "manual",
        rules: [rule(), rule({ id: "rule-2" })],
      }),
    ).toThrow("priority");
    expect(() =>
      validateUpdatePolicy({
        delivery: "manual",
        rules: [
          rule({
            groups: [
              {
                conditions: [
                  {
                    field: "platform",
                    operator: "exists",
                    value: "android",
                  },
                ],
              },
            ],
          }),
        ],
      }),
    ).toThrow("must be omitted");
  });

  it("fails corrupt persisted data safe to manual without a guard", () => {
    const onCorrupt = vi.fn();
    expect(
      createManifestUpdatePolicy({
        delivery: "background",
        rules: "corrupt",
        policyVersion: 4,
        context: {},
        onCorrupt,
      }),
    ).toEqual({
      schemaVersion: 1,
      policyVersion: 4,
      delivery: "manual",
    });
    expect(onCorrupt).toHaveBeenCalledOnce();
  });
});
