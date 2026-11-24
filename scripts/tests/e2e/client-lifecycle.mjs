import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { seedPublication } from "./delivery.mjs";

export async function exerciseClientLifecycle({
  origin,
  db,
  storage,
  password,
  publicKey,
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
    for (const kind of ["manual", "background", "required", "store"]) {
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
        delivery: kind === "background" ? "background" : "manual",
        expectedPolicyVersion: 1,
        guard:
          kind === "required"
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
