import { describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import path from "node:path";

const retryUrl = pathToFileURL(
  path.resolve("templates/expo-app/scripts/ota-publish/lib/retry.mjs"),
).href;

describe("portable publisher retry", () => {
  it("retries transient failures", async () => {
    const { withRetry } = await import(retryUrl);
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue("ok");

    await expect(
      withRetry("upload", task, { attempts: 3, baseDelayMs: 1 }),
    ).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("surfaces the final failure", async () => {
    const { withRetry } = await import(retryUrl);
    const task = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      withRetry("database", task, { attempts: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("database failed after 2 attempts: offline");
  });
});
