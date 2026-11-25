import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { planOtaClient } from "../../lib/ota-client-configurator.mjs";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { clientPackage, clientVersion } from "../../lib/ota-client-package.mjs";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { seedPublication } from "./delivery.mjs";

export async function exerciseClientLifecycle({
  origin,
  db,
  storage,
  password,
  publicKey,
  scratch,
}) {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const response = await fetch(origin + "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const suite = "client-" + randomUUID();
  const fixtures = {};
  for (const platform of ["ios", "android"]) {
    fixtures[platform] = {};
    for (const kind of [
      "manual",
      "manual-postpone",
      "background",
      "required",
      "immediate",
      "store",
    ]) {
      const channel = suite + "-" + kind;
      const scoped = { channel };
      const release = await seedPublication(
        db,
        storage,
        "Integration " + kind,
        false,
        platform,
        scoped,
      );
      const policy = {
        delivery:
          kind === "background" || kind === "immediate"
            ? "background"
            : kind === "manual-postpone" ? kind : "manual",
        expectedPolicyVersion: 1,
        guard:
          kind === "required" || kind === "immediate"
            ? { action: "ota-force-update" }
            : kind === "store"
              ? {
                  action: "ota-force-store-update",
                  payload: { url: "https://example.invalid/store" },
                }
              : null,
      };
      for (const [path, method, body] of [
        [release.path + "/policy", "PUT", policy],
        [release.path + "/deactivate", "POST", { disabled: false }],
      ]) {
        const res = await fetch(origin + path, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        assert.equal(res.status, 200, await res.text());
      }
      fixtures[platform][kind] = { channel };
      if (kind === "store" || kind === "required") {
        const replacement = await seedPublication(
          db,
          storage,
          "Unguarded replacement",
          false,
          platform,
          scoped,
        );
        fixtures[platform][kind].replacement = replacement.path;
      }
    }
  }
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const appRoot = path.join(scratch, "mobile");
  await mkdir(appRoot);
  await writeFile(
    path.join(appRoot, "index.js"),
    "import {registerRootComponent} from 'expo'; import App from './App'; registerRootComponent(App);",
  );
  await writeFile(
    path.join(appRoot, "App.jsx"),
    "export default function App() { return null; }",
  );
  const plan = planOtaClient({
    appRoot,
    templateRoot: path.join(root, "templates/expo-app"),
    packageJson: { main: "index.js" },
    manifestUrl: origin + "/api/manifest",
    channel: suite,
  });
  assert.deepEqual(plan.warnings, []);
  plan.apply();
  assert.match(
    await readFile(path.join(appRoot, "App.jsx"), "utf8"),
    /<OtaUpdates autoCheck autoUpdate=\{false\} autoReload=\{false\}/,
  );
  await symlink(
    path.join(root, "node_modules"),
    path.join(appRoot, "node_modules"),
    "dir",
  );
  // Run the policy scenarios against the files that a mobile app receives from npm.
  const sdkWorkspace = path.join(root, "packages/ota-client");
  const sdkSpec = existsSync(path.join(sdkWorkspace, "package.json"))
    ? sdkWorkspace
    : `${clientPackage}@${clientVersion}`;
  const [{ filename, version }] = JSON.parse(execFileSync("npm", [
    "pack", sdkSpec, "--json", "--pack-destination", scratch,
  ], { encoding: "utf8", cwd: scratch }));
  assert.equal(version, clientVersion);
  const packedDirectory = path.join(appRoot, "sdk");
  await mkdir(packedDirectory);
  execFileSync("tar", ["-xzf", path.join(scratch, filename), "-C", packedDirectory, "--strip-components=1"]);
  const resolveSdk = createRequire(path.join(packedDirectory, "package.json"));
  const sdkSource = path.dirname(resolveSdk.resolve(clientPackage));
  const child = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "scripts/tests/e2e/client-vitest.mts",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        OTA_E2E_CLIENT_DIRECTORY: sdkSource,
        OTA_LIFECYCLE_FIXTURE: JSON.stringify({
          origin,
          cookie,
          platforms: fixtures,
          publicKey: publicKey.export({ type: "spki", format: "pem" }),
        }),
      },
    },
  );
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "OTA client lifecycle HTTP scenarios");
}
