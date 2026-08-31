import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { configureExpoApp } from "./expo-app-configurator.mjs";

const temporaryDirectories: string[] = [];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ota-expo-config-"));
  temporaryDirectories.push(root);

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

  return { appRoot, certificatePath };
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
    const { appRoot, certificatePath } = createFixture();
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
      { commandRunner },
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
      "scripts/ota-register-embedded/android-register-embedded-update.sh",
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
          "android-register-embedded-update.sh",
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
    ).toBe(true);
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
    const { appRoot, certificatePath } = createFixture();
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
    const { appRoot, certificatePath } = createFixture();
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
      { commandRunner },
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
});
