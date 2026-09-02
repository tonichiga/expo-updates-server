import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  row: {
    blocked: false,
    version: 1,
    reason: null as string | null,
    changed_at: "2026-09-02T00:00:00.000Z" as string | Date,
    changed_by: {
      type: "system",
      id: "migration",
      label: "Database migration",
    },
  },
  readError: null as { message: string } | null,
  rpcError: null as { message: string } | null,
  rpcParams: null as Record<string, unknown> | null,
}));

vi.mock("./supabase.js", () => ({
  jsonb: (value: unknown) => value,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: database.readError ? null : database.row,
            error: database.readError,
          }),
        }),
      }),
    }),
    rpc: async (_name: string, params: Record<string, unknown>) => {
      database.rpcParams = params;
      if (database.rpcError) {
        return { data: null, error: database.rpcError };
      }
      database.row = {
        ...database.row,
        blocked: params.p_blocked === true,
        version: database.row.version + 1,
        reason:
          typeof params.p_reason === "string" ? params.p_reason : null,
        changed_at: new Date("2026-09-02T00:01:00.000Z"),
        changed_by: params.p_changed_by as typeof database.row.changed_by,
      };
      return { data: [database.row], error: null };
    },
  },
}));

import {
  DistributionControlConflictError,
  DistributionControlValidationError,
  getDistributionControlState,
  isOtaDistributionBlocked,
  setDistributionControlState,
} from "./distribution-control";

const principal = {
  type: "session" as const,
  id: "admin-id",
  label: "operator",
  role: "operator",
};

describe("OTA distribution control service", () => {
  beforeEach(() => {
    database.row = {
      blocked: false,
      version: 1,
      reason: null,
      changed_at: "2026-09-02T00:00:00.000Z",
      changed_by: {
        type: "system",
        id: "migration",
        label: "Database migration",
      },
    };
    database.readError = null;
    database.rpcError = null;
    database.rpcParams = null;
  });

  it("reads and maps the singleton without a process-local fallback", async () => {
    await expect(getDistributionControlState()).resolves.toMatchObject({
      blocked: false,
      version: 1,
      reason: null,
    });
    await expect(isOtaDistributionBlocked()).resolves.toBe(false);
  });

  it("normalizes a PostgreSQL timestamptz Date to an ISO string", async () => {
    database.row.changed_at = new Date("2026-09-01T21:31:08.722Z");

    await expect(getDistributionControlState()).resolves.toMatchObject({
      changedAt: "2026-09-01T21:31:08.722Z",
    });
  });

  it("rejects invalid changed_at strings and Dates", async () => {
    database.row.changed_at = "not-a-date";
    await expect(getDistributionControlState()).rejects.toThrow(
      "Invalid OTA distribution control changed_at.",
    );

    database.row.changed_at = new Date(Number.NaN);
    await expect(getDistributionControlState()).rejects.toThrow(
      "Invalid OTA distribution control changed_at.",
    );
  });

  it("does not interpret a database error or missing singleton as active", async () => {
    database.readError = { message: "relation does not exist" };
    await expect(isOtaDistributionBlocked()).rejects.toThrow(
      "Failed to read OTA distribution control",
    );

    database.readError = null;
    const savedRow = database.row;
    Object.assign(database, { row: null });
    await expect(getDistributionControlState()).rejects.toThrow("missing");
    database.row = savedRow;
  });

  it("validates and atomically delegates state plus principal audit metadata", async () => {
    const state = await setDistributionControlState({
      blocked: true,
      reason: "  INC-42 bad rollout  ",
      expectedVersion: 1,
      principal,
    });

    expect(state).toMatchObject({
      blocked: true,
      version: 2,
      reason: "INC-42 bad rollout",
      changedAt: "2026-09-02T00:01:00.000Z",
      changedBy: principal,
    });
    expect(database.rpcParams).toMatchObject({
      p_blocked: true,
      p_reason: "INC-42 bad rollout",
      p_expected_version: 1,
      p_changed_by: principal,
    });
  });

  it("requires a bounded reason and positive expectedVersion", async () => {
    await expect(
      setDistributionControlState({
        blocked: true,
        reason: " ",
        expectedVersion: 1,
        principal,
      }),
    ).rejects.toBeInstanceOf(DistributionControlValidationError);
    await expect(
      setDistributionControlState({
        blocked: false,
        expectedVersion: 0,
        principal,
      }),
    ).rejects.toBeInstanceOf(DistributionControlValidationError);
  });

  it("maps optimistic database conflicts to a typed 409 error", async () => {
    database.rpcError = {
      message: "OTA distribution control version conflict",
    };

    await expect(
      setDistributionControlState({
        blocked: false,
        expectedVersion: 1,
        principal,
      }),
    ).rejects.toBeInstanceOf(DistributionControlConflictError);
  });
});
