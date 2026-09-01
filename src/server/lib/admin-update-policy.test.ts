import { beforeEach, describe, expect, it, vi } from "vitest";

const policyDatabase = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updateCalls: 0,
}));

vi.mock("./supabase.js", () => ({
  jsonb: (value: unknown) => value,
  SUPABASE_BUCKET: "updates",
  supabase: {
    from: () => {
      let updatePayload: Record<string, unknown> | null = null;
      const builder = {
        select() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          policyDatabase.updateCalls += 1;
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        single() {
          return Promise.resolve({
            data: policyDatabase.row,
            error: policyDatabase.row ? null : { message: "not found" },
          });
        },
        maybeSingle() {
          if (updatePayload && policyDatabase.row) {
            policyDatabase.row = {
              ...policyDatabase.row,
              ...updatePayload,
            };
          }
          return Promise.resolve({
            data: policyDatabase.row,
            error: null,
          });
        },
      };
      return builder;
    },
  },
}));

import {
  getUpdatePolicyByKey,
  replaceUpdatePolicyByKey,
  UpdatePolicyPublishedError,
} from "./admin-updates";

const updateId = "22222222-2222-4222-8222-222222222222";

function makePolicyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    update_id: updateId,
    build_id: "33333333-3333-4333-8333-333333333333",
    comment: null,
    runtime_version: "runtime-1",
    channel: "production",
    platform: "ios",
    created_at: "2026-01-01T00:00:00.000Z",
    created_at_path: "2026/01/01/000000",
    storage_bucket: "updates",
    storage_base_path: "runtime-1/ios/update",
    is_active: false,
    updated_at: null,
    disabled_at: "2026-01-01T00:00:00.000Z",
    assets_count: 2,
    launch_asset_path: "bundle.js",
    rolled_back_from_update_id: null,
    delivery_mode: "manual",
    guard_rules: [],
    policy_version: 1,
    policy_published_at: null,
    manifest: {},
    inserted_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("OTA update policy service publication lock", () => {
  beforeEach(() => {
    policyDatabase.row = makePolicyRow();
    policyDatabase.updateCalls = 0;
  });

  it("edits delivery mode and guards on an inactive initial-disabled draft", async () => {
    const rule = {
      id: "confirm-android",
      enabled: true,
      priority: 10,
      action: "require-confirmation",
      groups: [
        {
          conditions: [
            { field: "platform", operator: "equals", value: "android" },
          ],
        },
      ],
    };

    expect(await getUpdatePolicyByKey(updateId)).toMatchObject({
      delivery: "manual",
      rules: [],
      publishedAt: null,
      editable: true,
    });

    const updated = await replaceUpdatePolicyByKey(
      updateId,
      { delivery: "background", rules: [rule] },
      1,
    );

    expect(updated).toMatchObject({
      delivery: "background",
      rules: [rule],
      policyVersion: 2,
      publishedAt: null,
      editable: true,
    });
    expect(policyDatabase.updateCalls).toBe(1);
  });

  it.each([
    [
      "active without a publication marker",
      { is_active: true, disabled_at: null, policy_published_at: null },
    ],
    [
      "inactive after publication",
      {
        is_active: false,
        disabled_at: "2026-01-02T00:00:00.000Z",
        policy_published_at: "2026-01-01T12:00:00.000Z",
      },
    ],
  ])("locks an %s row", async (_case, overrides) => {
    policyDatabase.row = makePolicyRow({
      ...overrides,
    });

    expect(await getUpdatePolicyByKey(updateId)).toMatchObject({
      editable: false,
    });
    await expect(
      replaceUpdatePolicyByKey(
        updateId,
        { delivery: "background", rules: [] },
        1,
      ),
    ).rejects.toBeInstanceOf(UpdatePolicyPublishedError);
    expect(policyDatabase.updateCalls).toBe(0);
  });
});
