import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  action_key: string;
  created_at: string;
};

const database = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  nextId: 1,
}));

vi.mock("./supabase.js", () => {
  class Query {
    private operation = "select";
    private actionKey = "";
    private id = "";

    select() {
      return this;
    }

    order() {
      return this;
    }

    upsert(payload: { action_key: string }) {
      this.operation = "upsert";
      this.actionKey = payload.action_key;
      if (!database.rows.has(this.actionKey)) {
        const suffix = String(database.nextId++).padStart(12, "0");
        database.rows.set(this.actionKey, {
          id: `00000000-0000-4000-8000-${suffix}`,
          action_key: this.actionKey,
          created_at: "2026-09-01T00:00:00.000Z",
        });
      }
      return this;
    }

    delete() {
      this.operation = "delete";
      return this;
    }

    eq(_column: string, value: string) {
      this.id = value;
      return this;
    }

    single() {
      return Promise.resolve({
        data: database.rows.get(this.actionKey),
        error: null,
      });
    }

    execute() {
      if (this.operation === "delete") {
        for (const [key, row] of database.rows) {
          if (row.id === this.id) database.rows.delete(key);
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({
        data: [...database.rows.values()].sort((left, right) =>
          left.action_key.localeCompare(right.action_key),
        ),
        error: null,
      });
    }
  }

  return {
    supabase: {
      from(table: string) {
        if (table !== "ota_guard_actions") {
          throw new Error(`Unexpected table ${table}`);
        }
        return new Query();
      },
    },
  };
});

describe("guard action catalog", () => {
  beforeEach(() => {
    database.rows.clear();
    database.nextId = 1;
  });

  it("trims valid values and rejects length and control characters", async () => {
    const { GuardActionValidationError, parseGuardActionInput } =
      await import("./guard-actions");

    expect(parseGuardActionInput({ actionKey: "  store-update  " })).toBe(
      "store-update",
    );
    expect(() => parseGuardActionInput({ actionKey: "" })).toThrow(
      GuardActionValidationError,
    );
    expect(() =>
      parseGuardActionInput({ actionKey: "bad\nvalue" }),
    ).toThrow(/control characters/);
    expect(() =>
      parseGuardActionInput({ actionKey: "x".repeat(101) }),
    ).toThrow(/between 1 and 100/);
  });

  it("creates or gets one row across concurrent duplicate creates", async () => {
    const { createGuardAction, listGuardActions } =
      await import("./guard-actions");
    const [first, second] = await Promise.all([
      createGuardAction({ actionKey: "same-action" }),
      createGuardAction({ actionKey: " same-action " }),
    ]);

    expect(first).toEqual(second);
    await expect(listGuardActions()).resolves.toEqual([first]);
  });

  it("sorts results and deletes a UUID idempotently", async () => {
    const { createGuardAction, deleteGuardAction, listGuardActions } =
      await import("./guard-actions");
    await createGuardAction({ actionKey: "zeta" });
    const alpha = await createGuardAction({ actionKey: "alpha" });

    expect((await listGuardActions()).map((item) => item.actionKey)).toEqual([
      "alpha",
      "zeta",
    ]);
    await deleteGuardAction(alpha.id);
    await deleteGuardAction(alpha.id);
    expect((await listGuardActions()).map((item) => item.actionKey)).toEqual([
      "zeta",
    ]);
    await expect(deleteGuardAction("not-a-uuid")).rejects.toThrow(
      /id must be a UUID/,
    );
  });
});
