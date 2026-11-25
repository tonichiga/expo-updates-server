import { describe, expect, it, vi } from "vitest";
import { getUpdatesPage } from "./admin-updates";

const database = vi.hoisted(() => ({
  ota_updates: [] as Array<Record<string, unknown>>,
  ota_update_channels: [] as Array<Record<string, unknown>>,
}));
vi.mock("./supabase.js", () => ({
  supabase: {
    from(table: keyof typeof database) {
      let cursor: string | number = "";
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        gt(_key: string, after: string | number) {
          cursor = after;
          return builder;
        },
        async execute() {
          // Simulate a PostgREST row cap below the requested batch size.
          const data = database[table]
            .filter((row) => String(row.id) > String(cursor))
            .slice(0, 2);
          return { data, error: null };
        },
      };
      return builder;
    },
  },
}));

const defaults = {
  page: 1,
  pageSize: 1,
  sortBy: "createdAt",
  order: "desc",
} as const;
function release(n: number, options: Record<string, unknown> = {}) {
  return {
    id: String(n),
    update_id: `22222222-2222-4222-8222-22222222222${n}`,
    is_active: true,
    comment: `Release ${n}`,
    runtime_version: "1.0",
    channel: "main",
    platform: "android",
    app_version: " 2.0 ",
    legacy_version: null,
    created_at: `2026-03-0${n}T00:00:00Z`,
    audience_mode: "all",
    storage_base_path: "test",
    ...options,
  };
}

describe("release history", () => {
  it("combines full-history search, filters and complete channel pointers before paging", async () => {
    database.ota_updates = [
      release(1),
      release(2),
      release(3, { channel: "old" }),
      release(4, {
        channel: "preview",
        platform: "ios",
        audience_mode: "devices",
        runtime_version: "2.1",
        app_version: null,
        legacy_version: " 4.2 ",
      }),
      release(5, {
        channel: "preview",
        platform: "ios",
        audience_mode: "devices",
        runtime_version: "2.1",
        app_version: "4.2",
        is_active: false,
      }),
    ];
    database.ota_update_channels = [
      { id: 1, channel: "main", runtime_version: "1.0", platform: "android" },
      { id: 2, channel: "old", runtime_version: "1.0", platform: "android" },
      {
        id: 3,
        channel: "preview",
        runtime_version: "2.1",
        platform: "ios",
        active_update_id: database.ota_updates[3].update_id,
        latest_update_id: database.ota_updates[4].update_id,
      },
    ];

    const filters = {
      q: " 4.2 ",
      platform: "ios",
      channel: "preview",
      audience: "devices",
      runtime: "2.1",
    };
    const page = await getUpdatesPage({ ...defaults, ...filters, page: 99 });
    expect(page).toMatchObject({
      total: 2,
      totalPages: 2,
      page: 2,
      items: [
        { comment: "Release 4", isRollbackActive: true, appVersion: "4.2" },
      ],
      filters: {
        channels: ["main", "old", "preview"],
        runtimes: ["1.0", "2.1"],
      },
    });
    expect(page.rollbackLockByScope.at(-1)).toMatchObject({
      channel: "preview",
      rollbackActive: true,
    });
    const draft = await getUpdatesPage({
      ...defaults,
      ...filters,
      q: "RELEASE",
      status: "draft",
    });
    expect(draft.items.map((item) => item.comment)).toEqual(["Release 5"]);
    const disabled = await getUpdatesPage({
      ...defaults,
      ...filters,
      status: "disabled",
    });
    expect(disabled.total).toBe(0);
    const rollback = await getUpdatesPage({
      ...defaults,
      ...filters,
      q: "222222222224",
      status: "rollback",
    });
    expect(rollback.total).toBe(1);
  });
});
