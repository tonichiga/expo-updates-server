import path from "node:path";
import { describe, expect, it } from "vitest";
import { getExpoExportCommand } from "../../templates/expo-app/scripts/ota-publish/lib/expo-export-command.mjs";

describe("getExpoExportCommand", () => {
  it("invokes the local Expo binary without duplicating the expo command", () => {
    const result = getExpoExportCommand({
      appRoot: "/tmp/example-app",
      outputDir: "/tmp/example-app/.ota-dist/android",
      platform: "android",
    });

    expect(result.command).toBe(
      path.join(
        "/tmp/example-app",
        "node_modules",
        ".bin",
        process.platform === "win32" ? "expo.cmd" : "expo",
      ),
    );
    expect(result.args).toEqual([
      "export",
      "--clear",
      "--platform",
      "android",
      "--output-dir",
      "/tmp/example-app/.ota-dist/android",
    ]);
    expect(result.args[0]).not.toBe("expo");
  });
});
