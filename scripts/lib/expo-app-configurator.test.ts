import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { configureExpoApp } from "./expo-app-configurator.mjs";

const temporaryDirectories: string[] = [];
const appTemplateRoot = path.resolve("templates/expo-app");
const registrarRelativePath = path.join(
  "scripts",
  "ota-register-embedded",
  "index.mjs",
);
const legacyRegistrarSha256 =
  "29c48288d4804c072129da0ef60a12ad0892809eb8d57a14be94d039d990d6d7";
const legacyAndroidRegistrar = `#!/bin/sh

set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
MANIFEST_PATH="$(find "$PROJECT_ROOT/android/app/build" -type f -name app.manifest 2>/dev/null | head -n 1 || true)"

if [ -z "$MANIFEST_PATH" ]; then
  echo "Embedded update registration failed: Android app.manifest was not found." >&2
  [ "\${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
  exit 0
fi

if ! node "$PROJECT_ROOT/scripts/ota-register-embedded/index.mjs" \\
  --manifest "$MANIFEST_PATH" \\
  --platform android; then
  [ "\${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
fi
`;
const legacyIosRegistrar = `#!/bin/sh

set -eu

if [ "\${CONFIGURATION:-Release}" = "Debug" ]; then
  exit 0
fi

PROJECT_ROOT="\${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
MANIFEST_PATH=""

for candidate in \\
  "\${TARGET_BUILD_DIR:-}/\${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}/app.manifest" \\
  "\${CI_ARCHIVE_PATH:-}/Products/Applications/"*.app/app.manifest
do
  if [ -f "$candidate" ]; then
    MANIFEST_PATH="$candidate"
    break
  fi
done

if [ -z "$MANIFEST_PATH" ] && [ -n "\${TARGET_BUILD_DIR:-}" ]; then
  MANIFEST_PATH="$(find "$TARGET_BUILD_DIR" -type f -name app.manifest 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$MANIFEST_PATH" ]; then
  echo "Embedded update registration failed: iOS app.manifest was not found." >&2
  [ "\${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
  exit 0
fi

if ! node "$PROJECT_ROOT/scripts/ota-register-embedded/index.mjs" \\
  --manifest "$MANIFEST_PATH" \\
  --platform ios; then
  [ "\${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
fi
`;
const legacyXcodeCloudHook = `#!/bin/sh

set -eu

export OTA_EMBEDDED_REGISTER_STRICT="\${OTA_EMBEDDED_REGISTER_STRICT:-true}"
sh "\${CI_PRIMARY_REPOSITORY_PATH}/ci_scripts/register-embedded-update.sh"
`;
const legacyIosPlugin = `const { withXcodeProject } = require("expo/config-plugins");

const PHASE_NAME = "Register Expo embedded update";

module.exports = function withOtaEmbeddedRegistration(config) {
  return withXcodeProject(config, (projectConfig) => {
    const project = projectConfig.modResults;
    const phases =
      project.hash.project.objects.PBXShellScriptBuildPhase || {};
    const phaseExists = Object.values(phases).some(
      (phase) =>
        phase &&
        typeof phase === "object" &&
        phase.name === \`"\${PHASE_NAME}"\`,
    );

    if (!phaseExists) {
      project.addBuildPhase(
        [],
        "PBXShellScriptBuildPhase",
        PHASE_NAME,
        project.getFirstTarget().uuid,
        {
          shellPath: "/bin/sh",
          shellScript:
            'OTA_EMBEDDED_REGISTER_STRICT=true sh "$PROJECT_DIR/../ci_scripts/register-embedded-update.sh"',
        },
      );
    }

    return projectConfig;
  });
};
`;

function readCurrentRegistrar() {
  return fs.readFileSync(
    path.join(appTemplateRoot, registrarRelativePath),
    "utf8",
  );
}

function createLegacyRegistrar() {
  const legacy = readCurrentRegistrar()
    .replace(
      `  const appVersion =
    readPath(manifest, [
      ["extra", "expoClient", "version"],
      ["expoClient", "version"],
      ["version"],
    ]) ||
    readPath(root, [
      ["extra", "expoClient", "version"],
      ["expoClient", "version"],
      ["version"],
    ]);
`,
      "",
    )
    .replace(
      `    appVersion: typeof appVersion === "string" ? appVersion : null,
`,
      "",
    )
    .replace(
      "        embedded_update_id, app_version, created_at, channel, platform, is_embedded\n" +
        "      ) VALUES ($1, $2, $3, $4, $5, true)",
      "        embedded_update_id, created_at, channel, platform, is_embedded\n" +
        "      ) VALUES ($1, $2, $3, $4, true)",
    )
    .replace(
      `        app_version = COALESCE(
          NULLIF(BTRIM(EXCLUDED.app_version), ''),
          ota_embedded_updates.app_version
        ),
`,
      "",
    )
    .replace("        input.appVersion || null,\n", "");

  const digest = crypto
    .createHash("sha256")
    .update(legacy)
    .digest("hex");
  if (digest !== legacyRegistrarSha256) {
    throw new Error(`Legacy registrar fixture hash changed: ${digest}`);
  }

  return legacy;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ota-expo-config-"));
  temporaryDirectories.push(root);

  const templateRoot = path.join(root, "expo-app-template");
  fs.cpSync(appTemplateRoot, templateRoot, { recursive: true });
  fs.writeFileSync(
    path.join(templateRoot, ".env.ota.example"),
    "EXPO_UPDATE_CHANNEL=production\n",
  );

  const appRoot = path.join(root, "app");
  fs.mkdirSync(appRoot, { recursive: true });
  fs.writeFileSync(
    path.join(appRoot, "package.json"),
    JSON.stringify(
      {
        name: "fixture-app",
        private: true,
        scripts: { start: "expo start" },
        dependencies: { expo: "~56.0.0" },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(appRoot, "package-lock.json"), "{}");
  fs.writeFileSync(
    path.join(appRoot, "app.json"),
    JSON.stringify(
      {
        expo: {
          name: "Fixture",
          slug: "fixture",
          extra: { existing: true },
          updates: {
            requestHeaders: { "x-existing": "value" },
          },
        },
      },
      null,
      2,
    ),
  );

  const certificatePath = path.join(root, "certificate.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "1",
    "-subj",
    "/CN=fixture",
    "-addext",
    "basicConstraints=critical,CA:FALSE",
    "-addext",
    "keyUsage=critical,digitalSignature",
    "-addext",
    "extendedKeyUsage=codeSigning",
    "-keyout",
    path.join(root, "private-key.pem"),
    "-out",
    certificatePath,
  ]);

  return { appRoot, certificatePath, templateRoot };
}

function createRunner() {
  const calls: Array<{
    command: string;
    args: string[];
    cwd: string;
  }> = [];

  const commandRunner = (command: string, args: string[], cwd: string) => {
    calls.push({ command, args, cwd });

    if (args.join(" ") === "expo install expo-updates") {
      const packagePath = path.join(cwd, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      packageJson.dependencies["expo-updates"] = "~56.0.0";
      fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
    }
  };

  return { calls, commandRunner };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("configureExpoApp", () => {
  it("configures receiving, publishing and native prebuild", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const { calls, commandRunner } = createRunner();

    const result = configureExpoApp(
      {
        app: appRoot,
        certificate: certificatePath,
        serverUrl: "https://updates.example.com/",
        channel: "Production",
        runtimeVersion: "1.2.3",
        platform: "all",
      },
      { commandRunner, templateRoot },
    );

    const appJson = JSON.parse(
      fs.readFileSync(path.join(appRoot, "app.json"), "utf8"),
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
    );

    expect(result).toMatchObject({
      appRoot,
      manifestUrl: "https://updates.example.com/api/manifest",
      channel: "production",
      runtimeVersion: "1.2.3",
      platform: "all",
      packageManager: "npm",
      publisherEnvConfigured: false,
      migrationWarnings: [],
    });

    expect(appJson.expo.runtimeVersion).toBe("1.2.3");
    expect(appJson.expo.updates).toMatchObject({
      enabled: true,
      url: "https://updates.example.com/api/manifest",
      checkAutomatically: "NEVER",
      codeSigningCertificate:
        "./certificates/code-signing-certificate.pem",
      requestHeaders: {
        "x-existing": "value",
        "expo-channel-name": "production",
      },
    });
    expect(appJson.expo.extra).toEqual({
      existing: true,
      updateChannel: "production",
    });
    expect(appJson.expo.plugins).toContain(
      "./plugins/with-ota-embedded-registration",
    );
    expect(packageJson.dependencies["expo-updates"]).toBe("~56.0.0");
    expect(packageJson.scripts["ota:publish"]).toBe(
      "node scripts/ota-publish/index.mjs",
    );
    expect(packageJson.scripts["ota:build:android:apk"]).toContain(
      "scripts/ota-register-embedded/register-android.sh",
    );
    expect(
      fs.readFileSync(
        path.join(
          appRoot,
          "certificates",
          "code-signing-certificate.pem",
        ),
        "utf8",
      ),
    ).toContain("BEGIN CERTIFICATE");
    expect(
      fs.existsSync(path.join(appRoot, "scripts", "ota-publish", "index.mjs")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-publish",
          "lib",
          "expo-export-command.mjs",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-publish",
          "api",
          "storage-client.mjs",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-publish",
          "api",
          "database-client.mjs",
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(appRoot, ".env.ota.example"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-register-embedded",
          "index.mjs",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-register-embedded",
          "register-android.sh",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-register-embedded",
          "register-ios.sh",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "plugins",
          "with-ota-embedded-registration.js",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(appRoot, "ci_scripts", "register-embedded-update.sh"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(appRoot, "ci_scripts", "ci_post_xcodebuild.sh"),
      ),
    ).toBe(true);
    expect(fs.readFileSync(path.join(appRoot, ".gitignore"), "utf8")).toBe(
      ".env.ota\n.ota-dist/\n",
    );
    expect(
      fs.readFileSync(path.join(appRoot, ".env.ota.example"), "utf8"),
    ).toContain("EXPO_UPDATE_CHANNEL=production");
    expect(calls).toEqual([
      {
        command: "npx",
        args: ["expo", "install", "expo-updates"],
        cwd: appRoot,
      },
      {
        command: "npm",
        args: [
          "install",
          "--save-dev",
          "@aws-sdk/client-s3",
          "dotenv",
          "pg",
        ],
        cwd: appRoot,
      },
      {
        command: "npx",
        args: ["expo", "prebuild"],
        cwd: appRoot,
      },
    ]);
  });

  it("creates publisher credentials from local Docker settings", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const serverRoot = path.dirname(appRoot);
    fs.writeFileSync(
      path.join(serverRoot, ".env"),
      [
        "POSTGRES_USER=ota_user",
        "POSTGRES_PASSWORD=db-password-with-@",
        "POSTGRES_DB=ota_database",
        "POSTGRES_PORT=5433",
        "MINIO_ROOT_USER=storage_user",
        "MINIO_ROOT_PASSWORD=storage-password",
        "MINIO_API_PORT=9100",
        "OTA_STORAGE_BUCKET=custom-bucket",
        "",
      ].join("\n"),
    );

    const result = configureExpoApp(
      {
        app: appRoot,
        certificate: certificatePath,
        serverUrl: "https://example-3000.euw.devtunnels.ms",
        channel: "development",
        runtimeVersion: "1.0.0",
      },
      {
        commandRunner: createRunner().commandRunner,
        serverRoot,
        templateRoot,
      },
    );

    const publisherEnv = fs.readFileSync(
      path.join(appRoot, ".env.ota"),
      "utf8",
    );
    expect(result.publisherEnvConfigured).toBe(true);
    expect(publisherEnv).toContain(
      "OTA_SERVER_URL=https://example-3000.euw.devtunnels.ms/api/manifest",
    );
    expect(publisherEnv).toContain(
      "OTA_DATABASE_URL=postgresql://ota_user:db-password-with-%40@127.0.0.1:5433/ota_database",
    );
    expect(publisherEnv).toContain("R2_ENDPOINT=http://127.0.0.1:9100");
    expect(publisherEnv).toContain("R2_ACCESS_KEY_ID=storage_user");
    expect(publisherEnv).toContain(
      "R2_SECRET_ACCESS_KEY=storage-password",
    );
    expect(publisherEnv).toContain("R2_BUCKET=custom-bucket");
  });

  it("stops an existing Android Gradle daemon before prebuild", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const gradleWrapper = path.join(appRoot, "android", "gradlew");
    fs.mkdirSync(path.dirname(gradleWrapper), { recursive: true });
    fs.writeFileSync(gradleWrapper, "#!/bin/sh\n");
    const { calls, commandRunner } = createRunner();

    configureExpoApp(
      {
        app: appRoot,
        certificate: certificatePath,
        serverUrl: "https://updates.example.com",
        channel: "production",
        runtimeVersion: "1.0.0",
        platform: "android",
      },
      { commandRunner, templateRoot },
    );

    const stopIndex = calls.findIndex(
      (call) => call.command === gradleWrapper && call.args[0] === "--stop",
    );
    const prebuildIndex = calls.findIndex(
      (call) => call.args.join(" ") === "expo prebuild --platform android",
    );
    expect(stopIndex).toBeGreaterThan(-1);
    expect(prebuildIndex).toBeGreaterThan(stopIndex);
  });

  it("rejects dynamic Expo config in static mode", () => {
    const { appRoot, certificatePath } = createFixture();
    fs.writeFileSync(path.join(appRoot, "app.config.ts"), "export default {};");

    expect(() =>
      configureExpoApp(
        {
          app: appRoot,
          certificate: certificatePath,
          serverUrl: "https://updates.example.com",
          channel: "production",
          runtimeVersion: "1.0.0",
        },
        { commandRunner: () => undefined },
      ),
    ).toThrow("app.config.ts overrides app.json");
  });

  it("rejects a private key passed as the public certificate", () => {
    const { appRoot, certificatePath } = createFixture();
    fs.writeFileSync(
      certificatePath,
      "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n",
    );

    expect(() =>
      configureExpoApp(
        {
          app: appRoot,
          certificate: certificatePath,
          serverUrl: "https://updates.example.com",
          channel: "production",
          runtimeVersion: "1.0.0",
        },
        { commandRunner: () => undefined },
      ),
    ).toThrow("public PEM certificate");
  });

  it("rejects certificates without Expo code-signing extensions", () => {
    const { appRoot, certificatePath } = createFixture();
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-subj",
      "/CN=invalid-fixture",
      "-keyout",
      path.join(path.dirname(certificatePath), "invalid-private-key.pem"),
      "-out",
      certificatePath,
    ]);

    expect(() =>
      configureExpoApp(
        {
          app: appRoot,
          certificate: certificatePath,
          serverUrl: "https://updates.example.com",
          channel: "production",
          runtimeVersion: "1.0.0",
        },
        { commandRunner: () => undefined },
      ),
    ).toThrow("Extended Key Usage: Code Signing");
  });

  it("does not overwrite generated publisher files without force", () => {
    const { appRoot, certificatePath } = createFixture();
    const originalAppJson = fs.readFileSync(
      path.join(appRoot, "app.json"),
      "utf8",
    );
    const publisherPath = path.join(
      appRoot,
      "scripts",
      "ota-publish",
      "index.mjs",
    );
    fs.mkdirSync(path.dirname(publisherPath), { recursive: true });
    fs.writeFileSync(publisherPath, "custom publisher");

    expect(() =>
      configureExpoApp(
        {
          app: appRoot,
          certificate: certificatePath,
          serverUrl: "https://updates.example.com",
          channel: "production",
          runtimeVersion: "1.0.0",
        },
        { commandRunner: () => undefined },
      ),
    ).toThrow("Re-run with --force");

    expect(fs.readFileSync(path.join(appRoot, "app.json"), "utf8")).toBe(
      originalAppJson,
    );
  });

  it("upgrades the exact legacy embedded registrar without force", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const registrarPath = path.join(appRoot, registrarRelativePath);
    fs.mkdirSync(path.dirname(registrarPath), { recursive: true });
    fs.writeFileSync(registrarPath, createLegacyRegistrar());

    configureExpoApp(
      {
        app: appRoot,
        certificate: certificatePath,
        serverUrl: "https://updates.example.com",
        channel: "production",
        runtimeVersion: "1.0.0",
      },
      {
        commandRunner: createRunner().commandRunner,
        templateRoot,
      },
    );

    expect(fs.readFileSync(registrarPath, "utf8")).toBe(
      readCurrentRegistrar(),
    );
  });

  it("rejects a customized legacy embedded registrar without force", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const registrarPath = path.join(appRoot, registrarRelativePath);
    const customizedRegistrar =
      `${createLegacyRegistrar()}\n// User customization.\n`;
    fs.mkdirSync(path.dirname(registrarPath), { recursive: true });
    fs.writeFileSync(registrarPath, customizedRegistrar);

    expect(() =>
      configureExpoApp(
        {
          app: appRoot,
          certificate: certificatePath,
          serverUrl: "https://updates.example.com",
          channel: "production",
          runtimeVersion: "1.0.0",
        },
        {
          commandRunner: createRunner().commandRunner,
          templateRoot,
        },
      ),
    ).toThrow(`Refusing to overwrite ${registrarPath}`);

    expect(fs.readFileSync(registrarPath, "utf8")).toBe(
      customizedRegistrar,
    );
  });

  it("accepts the identical current embedded registrar idempotently", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const registrarPath = path.join(appRoot, registrarRelativePath);
    const currentRegistrar = readCurrentRegistrar();
    const options = {
      app: appRoot,
      certificate: certificatePath,
      serverUrl: "https://updates.example.com",
      channel: "production",
      runtimeVersion: "1.0.0",
    };
    fs.mkdirSync(path.dirname(registrarPath), { recursive: true });
    fs.writeFileSync(registrarPath, currentRegistrar);

    const firstRunner = createRunner();
    const secondRunner = createRunner();
    configureExpoApp(options, {
      commandRunner: firstRunner.commandRunner,
      templateRoot,
    });
    configureExpoApp(options, {
      commandRunner: secondRunner.commandRunner,
      templateRoot,
    });

    expect(fs.readFileSync(registrarPath, "utf8")).toBe(
      currentRegistrar,
    );
  });

  it("migrates exact legacy platform registrars without force", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const legacyAndroidPath = path.join(
      appRoot,
      "scripts",
      "ota-register-embedded",
      "android-register-embedded-update.sh",
    );
    const legacyIosPath = path.join(
      appRoot,
      "ci_scripts",
      "register-embedded-update.sh",
    );
    const xcodeCloudHookPath = path.join(
      appRoot,
      "ci_scripts",
      "ci_post_xcodebuild.sh",
    );
    const iosPluginPath = path.join(
      appRoot,
      "plugins",
      "with-ota-embedded-registration.js",
    );
    fs.mkdirSync(path.dirname(legacyAndroidPath), { recursive: true });
    fs.mkdirSync(path.dirname(legacyIosPath), { recursive: true });
    fs.mkdirSync(path.dirname(iosPluginPath), { recursive: true });
    fs.writeFileSync(legacyAndroidPath, legacyAndroidRegistrar);
    fs.writeFileSync(legacyIosPath, legacyIosRegistrar);
    fs.writeFileSync(xcodeCloudHookPath, legacyXcodeCloudHook);
    fs.writeFileSync(iosPluginPath, legacyIosPlugin);

    const packagePath = path.join(appRoot, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    packageJson.scripts["ota:build:android:apk"] =
      "build && sh scripts/ota-register-embedded/android-register-embedded-update.sh";
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

    const result = configureExpoApp(
      {
        app: appRoot,
        certificate: certificatePath,
        serverUrl: "https://updates.example.com",
        channel: "production",
        runtimeVersion: "1.0.0",
      },
      {
        commandRunner: createRunner().commandRunner,
        templateRoot,
      },
    );

    const configuredPackage = JSON.parse(
      fs.readFileSync(packagePath, "utf8"),
    );
    expect(result.migrationWarnings).toEqual([]);
    expect(fs.existsSync(legacyAndroidPath)).toBe(false);
    expect(fs.existsSync(legacyIosPath)).toBe(false);
    expect(fs.readFileSync(xcodeCloudHookPath, "utf8")).toContain(
      "scripts/ota-register-embedded/register-ios.sh",
    );
    expect(fs.readFileSync(iosPluginPath, "utf8")).toContain(
      "scripts/ota-register-embedded/register-ios.sh",
    );
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-register-embedded",
          "register-android.sh",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          appRoot,
          "scripts",
          "ota-register-embedded",
          "register-ios.sh",
        ),
      ),
    ).toBe(true);
    expect(
      configuredPackage.scripts["ota:build:android:apk"],
    ).toContain("scripts/ota-register-embedded/register-android.sh");
  });

  it("preserves and reports customized obsolete platform registrars", () => {
    const { appRoot, certificatePath, templateRoot } = createFixture();
    const legacyAndroidPath = path.join(
      appRoot,
      "scripts",
      "ota-register-embedded",
      "android-register-embedded-update.sh",
    );
    const legacyIosPath = path.join(
      appRoot,
      "ci_scripts",
      "register-embedded-update.sh",
    );
    fs.mkdirSync(path.dirname(legacyAndroidPath), { recursive: true });
    fs.mkdirSync(path.dirname(legacyIosPath), { recursive: true });
    fs.writeFileSync(legacyAndroidPath, "# custom Android registrar\n");
    fs.writeFileSync(legacyIosPath, "# custom iOS registrar\n");

    const result = configureExpoApp(
      {
        app: appRoot,
        certificate: certificatePath,
        serverUrl: "https://updates.example.com",
        channel: "production",
        runtimeVersion: "1.0.0",
      },
      {
        commandRunner: createRunner().commandRunner,
        templateRoot,
      },
    );

    expect(fs.readFileSync(legacyAndroidPath, "utf8")).toBe(
      "# custom Android registrar\n",
    );
    expect(fs.readFileSync(legacyIosPath, "utf8")).toBe(
      "# custom iOS registrar\n",
    );
    expect(result.migrationWarnings).toHaveLength(2);
    expect(result.migrationWarnings.join("\n")).toContain(
      "Preserved customized legacy Android registrar",
    );
    expect(result.migrationWarnings.join("\n")).toContain(
      "Preserved customized legacy iOS registrar",
    );
  });
});
