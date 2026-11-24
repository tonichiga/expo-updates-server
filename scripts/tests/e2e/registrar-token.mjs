import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// Exercise the interactive CLI used before registering embedded builds in CI.
export async function checkRegistrarToken(origin, databaseUrl, cwd) {
  const cli = fileURLToPath(
    new URL("../../create-access-token.mjs", import.meta.url),
  );
  const child = spawn(process.execPath, [cli], {
    cwd,
    env: {
      PATH: process.env.PATH,
      DATABASE_PROVIDER: "pg",
      DATABASE_URL: databaseUrl,
    },
  });
  let output = "";
  const answers = [
    ["Token name [mobile-builds]: ", "registration-ci"],
    ["Scopes [updates:write]: ", "updates:write"],
    ["Expiration as ISO date, or leave empty for no expiration: ", ""],
  ];
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (answers.length && output.includes(answers[0][0])) {
      child.stdin.write(answers.shift()[1] + "\n");
    }
  });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, "Create a registration token in PostgreSQL");
    const token = output.match(/\bota_[\w-]+\b/)?.[0];
    assert.ok(token);
    const response = await fetch(origin + "/api/admin/updates", {
      headers: { authorization: "Bearer " + token },
    });
    assert.equal(response.status, 403, "Write-only token does not grant reads");
    const registered = await fetch(origin + "/api/admin/embedded-updates", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        embeddedUpdateId: crypto.randomUUID(),
        appVersion: "1.0",
        channel: "internal-ci",
        platform: "android",
        createdAt: new Date().toISOString(),
      }),
    });
    assert.equal(registered.status, 201);
  } finally {
    clearTimeout(timer);
  }
}
