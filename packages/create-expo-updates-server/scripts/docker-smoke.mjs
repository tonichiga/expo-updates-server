import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run against a generated project: never load its .env or reuse its volumes/keys.
export async function dockerSmoke(projectDirectory) {
  const work = await mkdtemp(path.join(os.tmpdir(), "ota-docker-smoke-"));
  const project = `ota-smoke-${randomBytes(6).toString("hex")}`;
  const compose = ["compose", "--project-directory", path.resolve(projectDirectory),
    "--project-name", project, "--env-file", path.join(work, ".env"),
    "-f", path.resolve(projectDirectory, "docker-compose.yml"), "-f", path.join(work, "compose.yml")];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(COMPOSE_|POSTGRES_|MINIO_|OTA_|R2_|CODE_SIGNING_)/.test(key)));
  function run(command, args, capture = false) {
    const result = spawnSync(command, args, {
      env, encoding: "utf8", stdio: capture ? "pipe" : "inherit", timeout: 30 * 60_000,
    });
    assert.equal(result.status, 0, `${command} failed: ${result.error ?? result.stderr ?? result.status}`);
    return result.stdout?.trim();
  }
  const docker = (args, capture = false) => run("docker", [...compose, ...args], capture);
  try {
    const keys = path.join(work, "keys");
    await mkdir(keys);
    const key = path.join(keys, "code-signing-private-key.pem");
    run("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", key], true);
    // Disposable test key; container UID 1001 needs read access on Linux too.
    await chmod(key, 0o644);
    await writeFile(path.join(work, ".env"), [
      `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
      `MINIO_ROOT_PASSWORD=${randomBytes(24).toString("hex")}`,
    ].join("\n"));
    // YAML !override is needed to replace, rather than append, published ports.
    const override = `services:\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  minio:\n    ports: !override ["127.0.0.1::9000", "127.0.0.1::9001"]\n  app:\n    ports: !override ["127.0.0.1::3000"]\n    volumes: !override [${JSON.stringify(`${keys}:/run/secrets/ota:ro`)}]\n`;
    await writeFile(path.join(work, "compose.yml"), override);
    docker(["up", "-d", "--build", "--wait", "--wait-timeout", "180"]);
    const address = docker(["port", "app", "3000"], true);
    const health = await fetch(`http://${address}/api/health`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(health.status, 200);
    docker(["exec", "-T", "app", "node", "--input-type=module", "-e", `
      import { readFileSync } from 'node:fs';
      import { createPrivateKey } from 'node:crypto';
      import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
      createPrivateKey(readFileSync(process.env.CODE_SIGNING_PRIVATE_KEY_PATH));
      const client = new S3Client({ endpoint: process.env.R2_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
      const object = { Bucket: process.env.R2_BUCKET, Key: 'docker-smoke-test' };
      try {
        await client.send(new PutObjectCommand({ ...object, Body: 'ota-smoke' }));
        const result = await client.send(new GetObjectCommand(object));
        if (await result.Body.transformToString() !== 'ota-smoke') throw new Error('Storage round trip failed');
      } finally { await client.send(new DeleteObjectCommand(object)); client.destroy(); }
    `]);
    // A second initialization must succeed with the existing bucket.
    docker(["run", "--rm", "--no-deps", "minio-init"]);
    console.log("Docker smoke passed: fresh startup, database health, signing key, storage round trip, repeated initialization.");
  } finally {
    try { docker(["down", "--volumes", "--remove-orphans"]); }
    finally { await rm(work, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await dockerSmoke(process.argv[2] ?? process.cwd());
}
