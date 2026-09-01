import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
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

  it("falls back from a real-shape Expo manifest to app.json version", async () => {
    const {
      parseEmbeddedManifest,
      parseEmbeddedManifestForProject,
    } = await import(registrarUrl);
    const manifest = JSON.stringify({
      id: "55555555-5555-4555-8555-555555555555",
      commitTime: 1_767_225_600,
      assets: [],
    });
    const fallbackDate = new Date("2026-02-03T04:05:06Z");
    const readAppJson = (filePath: string, encoding: string) => {
      expect(filePath).toBe(path.join("/expo-project", "app.json"));
      expect(encoding).toBe("utf8");
      return JSON.stringify({ expo: { version: " 1.7.11 " } });
    };

    expect(parseEmbeddedManifest(manifest, fallbackDate).appVersion).toBeNull();
    expect(
      parseEmbeddedManifestForProject(
        manifest,
        "/expo-project",
        fallbackDate,
        readAppJson,
      ),
    ).toEqual({
      embeddedUpdateId: "55555555-5555-4555-8555-555555555555",
      appVersion: "1.7.11",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("keeps manifest app version ahead of the app.json fallback", async () => {
    const { parseEmbeddedManifestForProject } = await import(registrarUrl);
    let appJsonRead = false;
    const result = parseEmbeddedManifestForProject(
      JSON.stringify({
        id: "55555555-5555-4555-8555-555555555555",
        commitTime: "2026-01-01T00:00:00Z",
        assets: [],
        extra: { expoClient: { version: "2.4.1" } },
      }),
      "/expo-project",
      new Date("2026-02-03T04:05:06Z"),
      () => {
        appJsonRead = true;
        return JSON.stringify({ expo: { version: "1.7.11" } });
      },
    );

    expect(result.appVersion).toBe("2.4.1");
    expect(appJsonRead).toBe(false);
  });

  it.each([
    ["missing", () => {
      throw new Error("ENOENT");
    }],
    ["blank", () => JSON.stringify({ expo: { version: "   " } })],
    ["malformed JSON", () => "{not-json"],
    ["malformed version", () =>
      JSON.stringify({ expo: { version: { major: 1 } } })],
  ])(
    "keeps registration fields valid when app.json version is %s",
    async (_case, readAppJson) => {
      const { parseEmbeddedManifestForProject } = await import(registrarUrl);
      const result = parseEmbeddedManifestForProject(
        JSON.stringify({
          id: "55555555-5555-4555-8555-555555555555",
          commitTime: "2026-01-01T00:00:00Z",
          assets: [],
        }),
        "/expo-project",
        new Date("2026-02-03T04:05:06Z"),
        readAppJson,
      );

      expect(result).toEqual({
        embeddedUpdateId: "55555555-5555-4555-8555-555555555555",
        appVersion: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    },
  );

  it("contains no application-specific paths or names", () => {
    const templateRoot = path.resolve("templates/expo-app");
    const files = [
      "scripts/ota-register-embedded/index.mjs",
      "scripts/ota-register-embedded/register-android.sh",
      "scripts/ota-register-embedded/register-ios.sh",
      "ci_scripts/ci_post_xcodebuild.sh",
      "plugins/with-ota-embedded-registration.js",
    ];
    const content = files
      .map((file) => fs.readFileSync(path.join(templateRoot, file), "utf8"))
      .join("\n");

    expect(content.toLowerCase()).not.toContain("miex");
  });

  it("uses the canonical iOS registrar from local Xcode and Xcode Cloud", () => {
    const templateRoot = path.resolve("templates/expo-app");
    const iosRegistrar = fs.readFileSync(
      path.join(
        templateRoot,
        "scripts/ota-register-embedded/register-ios.sh",
      ),
      "utf8",
    );
    const cloudAdapter = fs.readFileSync(
      path.join(templateRoot, "ci_scripts/ci_post_xcodebuild.sh"),
      "utf8",
    );
    const plugin = fs.readFileSync(
      path.join(
        templateRoot,
        "plugins/with-ota-embedded-registration.js",
      ),
      "utf8",
    );

    expect(iosRegistrar).toContain(
      '${TARGET_BUILD_DIR:-}',
    );
    expect(iosRegistrar).toContain('${CI_ARCHIVE_PATH:-}');
    expect(iosRegistrar).toContain(
      '${OTA_EMBEDDED_REGISTER_STRICT:-false}',
    );
    expect(iosRegistrar).toContain(
      '[ "${CONFIGURATION:-Release}" = "Debug" ]',
    );
    expect(cloudAdapter).toContain(
      "scripts/ota-register-embedded/register-ios.sh",
    );
    expect(cloudAdapter).toContain("CI_PRIMARY_REPOSITORY_PATH");
    expect(plugin).toContain(
      'scripts/ota-register-embedded/register-ios.sh',
    );
    expect(plugin).not.toContain("ci_scripts/register-embedded-update.sh");
  });

  it("preserves iOS Debug skip and strict/non-strict behavior", () => {
    const iosRegistrar = path.resolve(
      "templates/expo-app/scripts/ota-register-embedded/register-ios.sh",
    );
    const baseEnv = {
      ...process.env,
      TARGET_BUILD_DIR: "",
      UNLOCALIZED_RESOURCES_FOLDER_PATH: "",
      CI_ARCHIVE_PATH: "",
    };

    const debug = spawnSync("sh", [iosRegistrar], {
      encoding: "utf8",
      env: {
        ...baseEnv,
        CONFIGURATION: "Debug",
        OTA_EMBEDDED_REGISTER_STRICT: "true",
      },
    });
    const nonStrict = spawnSync("sh", [iosRegistrar], {
      encoding: "utf8",
      env: {
        ...baseEnv,
        CONFIGURATION: "Release",
        OTA_EMBEDDED_REGISTER_STRICT: "false",
      },
    });
    const strict = spawnSync("sh", [iosRegistrar], {
      encoding: "utf8",
      env: {
        ...baseEnv,
        CONFIGURATION: "Release",
        OTA_EMBEDDED_REGISTER_STRICT: "true",
      },
    });

    expect(debug.status).toBe(0);
    expect(debug.stderr).toBe("");
    expect(nonStrict.status).toBe(0);
    expect(nonStrict.stderr).toContain("iOS app.manifest was not found");
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain("iOS app.manifest was not found");
  });

  it("fails clearly when the Xcode Cloud project root is unavailable", () => {
    const cloudAdapter = path.resolve(
      "templates/expo-app/ci_scripts/ci_post_xcodebuild.sh",
    );
    const result = spawnSync("sh", [cloudAdapter], {
      encoding: "utf8",
      env: {
        ...process.env,
        CI_PRIMARY_REPOSITORY_PATH:
          "/path-that-does-not-exist/expo-app",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "CI_PRIMARY_REPOSITORY_PATH is unavailable",
    );
  });

  it("updates an existing Xcode registration phase to the canonical path", () => {
    const pluginPath = path.resolve(
      "templates/expo-app/plugins/with-ota-embedded-registration.js",
    );
    const pluginSource = fs.readFileSync(pluginPath, "utf8");
    const pluginModule = { exports: {} as (config: unknown) => unknown };
    const loadPlugin = vm.runInNewContext(
      `(function (require, module, exports) { ${pluginSource}\n })`,
    );
    loadPlugin(
      (specifier: string) => {
        if (specifier !== "expo/config-plugins") {
          throw new Error(`Unexpected module: ${specifier}`);
        }
        return {
          withXcodeProject: (
            config: unknown,
            action: (value: unknown) => unknown,
          ) => action(config),
        };
      },
      pluginModule,
      pluginModule.exports,
    );

    const phase = {
      name: '"Register Expo embedded update"',
      shellPath: "/bin/sh",
      shellScript: '"legacy path"',
    };
    const projectConfig = {
      modResults: {
        hash: {
          project: {
            objects: {
              PBXShellScriptBuildPhase: { phase },
            },
          },
        },
        addBuildPhase: () => {
          throw new Error("Existing phase must be updated, not duplicated");
        },
        getFirstTarget: () => ({ uuid: "TARGET" }),
      },
    };

    pluginModule.exports(projectConfig);

    expect(phase.shellScript).toContain(
      "scripts/ota-register-embedded/register-ios.sh",
    );
    expect(phase.shellScript).not.toContain(
      "ci_scripts/register-embedded-update.sh",
    );
  });
});
