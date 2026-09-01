import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const registrarUrl = pathToFileURL(
  path.resolve(
    "templates/expo-app/scripts/ota-register-embedded/index.mjs",
  ),
).href;

describe("embedded update registrar", () => {
  it("extracts Expo update fields from a nested manifest", async () => {
    const { parseEmbeddedManifest } = await import(registrarUrl);
    const result = parseEmbeddedManifest(
      JSON.stringify({
        manifest: JSON.stringify({
          id: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-01-01T00:00:00Z",
          extra: {
            expoClient: {
              version: "2.4.1",
            },
          },
        }),
      }),
    );

    expect(result).toEqual({
      embeddedUpdateId: "55555555-5555-4555-8555-555555555555",
      appVersion: "2.4.1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("creates stable fallback fields without metadata", async () => {
    const { parseEmbeddedManifest } = await import(registrarUrl);
    const fallbackDate = new Date("2026-02-03T04:05:06Z");
    const first = parseEmbeddedManifest(
      '{"runtimeVersion":"1.0.0"}',
      fallbackDate,
    );
    const second = parseEmbeddedManifest(
      '{"runtimeVersion":"1.0.0"}',
      fallbackDate,
    );

    expect(first).toEqual(second);
    expect(first.embeddedUpdateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.appVersion).toBeNull();
    expect(first.createdAt).toBe("2026-02-03T04:05:06.000Z");
  });

  it("contains no application-specific paths or names", () => {
    const templateRoot = path.resolve("templates/expo-app");
    const files = [
      "scripts/ota-register-embedded/index.mjs",
      "scripts/ota-register-embedded/android-register-embedded-update.sh",
      "ci_scripts/register-embedded-update.sh",
      "ci_scripts/ci_post_xcodebuild.sh",
      "plugins/with-ota-embedded-registration.js",
    ];
    const content = files
      .map((file) => fs.readFileSync(path.join(templateRoot, file), "utf8"))
      .join("\n");

    expect(content.toLowerCase()).not.toContain("miex");
  });
});
