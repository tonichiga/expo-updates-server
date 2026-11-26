import { expect, it, vi } from "vitest";
import { getDistributionHistory } from "./distribution-history";

const execute = vi.hoisted(() => vi.fn());
vi.mock("./supabase.js", () => {
  const query = {
    select: () => query, neq: () => query, gt: () => query,
    order: () => query, limit: () => query, execute,
  };
  return { supabase: { from: () => query } };
});

it("orders all history pages by descending runtime, then channel and platform", async () => {
  const row = (id: number, runtime_version: string, channel = "production", platform = "ios") =>
    ({ id, runtime_version, channel, platform, revision: "1", current_release: null, previous_release: null });
  const rows = [
    row(1, "1.1.9"), row(2, "1.1.26-rc.2"), row(3, "custom-8"),
    row(4, "1.1.26"), row(5, "1.1.10"), row(6, "1.1.26", "development", "ios"),
    row(7, "1.1.26", "development", "android"), row(8, "custom-10"),
  ];
  execute.mockResolvedValueOnce({ data: rows.slice(0, 4) })
    .mockResolvedValueOnce({ data: rows.slice(4) }).mockResolvedValueOnce({ data: [] });
  expect((await getDistributionHistory()).map(scope => [scope.runtimeVersion, scope.channel, scope.platform]))
    .toEqual([7, 6, 4, 2, 5, 1, 8, 3].map(id => {
      const row = rows[id - 1];
      return [row.runtime_version, row.channel, row.platform];
    }));
});
