import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectInteractiveOptions } from "./expo-app-prompts.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("collectInteractiveOptions", () => {
  it("uses application defaults and confirms the configuration", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ota-prompts-"));
    temporaryDirectories.push(root);
    const appRoot = path.join(root, "app");
    fs.mkdirSync(appRoot);
    fs.writeFileSync(
      path.join(appRoot, "app.json"),
      JSON.stringify({
        expo: {
          runtimeVersion: "1.1.20",
          updates: {
            url: "http://localhost:3000/api/manifest",
            requestHeaders: {
              "expo-channel-name": "development",
            },
          },
        },
      }),
    );

    const answers = [
      "ru",
      appRoot,
      "",
      "",
      "",
      "",
      "",
      "n",
      "да",
    ];
    const logs: string[] = [];

    const result = await collectInteractiveOptions(
      {},
      {
        ask: async () => answers.shift() || "",
        serverRoot: root,
        log: (value) => logs.push(value),
      },
    );

    expect(result).toEqual({
      app: appRoot,
      certificate: path.join(
        root,
        "local-certificates",
        "code-signing-certificate.pem",
      ),
      serverUrl: "http://localhost:3000/api/manifest",
      channel: "development",
      runtimeVersion: "1.1.20",
      platform: "all",
      force: false,
    });
    expect(logs.join("\n")).toContain("Будут применены настройки");
  });

  it("cancels unless the user explicitly confirms", async () => {
    const answers = [
      "en",
      "/tmp/app",
      "/tmp/certificate.pem",
      "https://updates.example.com",
      "production",
      "1.0.0",
      "android",
      "n",
      "n",
    ];

    await expect(
      collectInteractiveOptions(
        {},
        {
          ask: async () => answers.shift() || "",
          log: () => undefined,
        },
      ),
    ).rejects.toThrow("Configuration cancelled");
  });
});
