import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("./supabase.js", () => ({ supabase: { rpc } }));
vi.mock("./distribution-control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./distribution-control")>()),
  assertOtaDistributionAllowed: async () => undefined,
}));

import { setUpdateDisabledByKey, promoteLatestByKey, rollbackToUpdateByKey } from "./admin-updates";
import { changeDistribution, DistributionHistoryConflictError } from "./distribution-history";
import { OtaDistributionBlockedError } from "./distribution-control";

const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => rpc.mockReset());

it.each([
  ["activate", () => setUpdateDisabledByKey(id, false)],
  ["stop", () => setUpdateDisabledByKey(id, true)],
  ["promote", () => promoteLatestByKey(id)],
  ["rollback", () => rollbackToUpdateByKey(id)],
])("submits %s as one transactional operation", async (action, mutate) => {
  rpc.mockResolvedValue({ data: [{ result: { updated: true } }] });
  await expect(mutate()).resolves.toMatchObject({ updated: true });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("ota_change_distribution", {
    p_update: id, p_action: action, p_revision: null,
  });
});

it("requires the observed revision for history restore and maps a stale target to a conflict", async () => {
  rpc.mockResolvedValue({ error: { message: "DISTRIBUTION_CONFLICT: refresh" } });
  await expect(changeDistribution(id, "restore", "17")).rejects.toBeInstanceOf(DistributionHistoryConflictError);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("ota_change_distribution", {
    p_update: id, p_action: "restore", p_revision: "17",
  });
});

it("maps a concurrent emergency stop to the same blocked response as the initial check", async () => {
  rpc.mockResolvedValue({ error: { message: "OTA_DISTRIBUTION_BLOCKED: restore" } });
  await expect(changeDistribution(id, "restore", "17")).rejects.toBeInstanceOf(OtaDistributionBlockedError);
});
