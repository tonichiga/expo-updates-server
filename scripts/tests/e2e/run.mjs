// Own the database, object store, signing key and HTTP process for the whole run.
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import bcrypt from "bcryptjs";
import { exerciseClientLifecycle } from "./client-lifecycle.mjs";
import { exerciseDelivery, seedPublication } from "./delivery.mjs";
import { checkRegistrarToken } from "./registrar-token.mjs";
import { exerciseConsole } from "./console.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), "ota-e2e-"));
const suffix = randomUUID();
const password = randomBytes(24).toString("hex");
const containers = [];
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
let db, server, storage;
async function ready(check, label) {
  let last;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
    }
    if (server && server.exitCode !== null) break;
    await delay(500);
  }
  throw new Error(label, { cause: last });
}
function container(name, port, ...args) {
  const id = docker(
    "run",
    "--rm",
    "-d",
    "--name",
    name + "-" + suffix,
    "-p",
    "127.0.0.1::" + port,
    ...args,
  );
  containers.push(id);
  return Number(docker("port", id, String(port)).split(":").at(-1));
}
try {
  const image = process.env.OTA_E2E_MINIO_IMAGE || "ota-e2e-minio";
  if (!process.env.OTA_E2E_MINIO_IMAGE)
    docker(
      "build",
      "-q",
      "-t",
      image,
      "-f",
      path.join(root, "docker/minio.Dockerfile"),
      path.join(root, "docker"),
    );
  const pgPort = container(
    "ota-e2e-db",
    5432,
    "-e",
    "POSTGRES_PASSWORD=" + password,
    "postgres:17-alpine",
  );
  const storagePort = container(
    "ota-e2e-store",
    9000,
    "-e",
    "MINIO_ROOT_USER=e2e-local",
    "-e",
    "MINIO_ROOT_PASSWORD=" + password,
    image,
    "server",
    "/data",
  );
  const DATABASE_URL =
    "postgresql://postgres:" + password + "@127.0.0.1:" + pgPort + "/postgres";
  const endpoint = "http://127.0.0.1:" + storagePort;
  db = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  storage = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "e2e-local", secretAccessKey: password },
  });
  await ready(() => db.query("select 1"), "PostgreSQL startup");
  await ready(
    () => storage.send(new CreateBucketCommand({ Bucket: "ota-fixtures" })),
    "Object store startup",
  );

  // Exercise fresh and upgrade paths in separate databases on this run's
  // disposable PostgreSQL instance. Each migration test requires an empty DB.
  for (const [database, script, ...args] of [
    ["analytics_fresh", "device-analytics-migrations.mjs", "--fresh"],
    ["analytics_upgrade", "device-analytics-migrations.mjs"],
    ["public_history_upgrade", "public-distribution-history.mjs"],
  ]) {
    await db.query("CREATE DATABASE " + database);
    const testUrl = new URL(DATABASE_URL);
    testUrl.pathname = "/" + database;
    execFileSync(process.execPath, [path.join(root, "scripts/tests", script), ...args], {
      env: { ...process.env, OTA_TEST_DATABASE_URL: testUrl.href },
      stdio: "inherit",
    });
  }
  const schema = await readFile(path.join(root, "docs/migrations/schema.sql"), "utf8");
  await db.query(schema);
  const old = await seedPublication(db, storage, "Initial public build", true);
  const hash = await bcrypt.hash(password, 4);
  for (const role of ["admin", "viewer"]) {
    await db.query(
      "insert into ota_admin_users(username,password_hash,role) values($1,$2,$1)",
      [role, hash],
    );
  }
  const scratchApp = path.join(scratch, "server");
  await mkdir(scratchApp);
  // Copy only source inputs. Next loads .env.local automatically from its app directory.
  for (const name of [
    "app",
    "components",
    "hooks",
    "lib",
    "src",
    "public",
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
  ]) {
    await cp(path.join(root, name), path.join(scratchApp, name), {
      recursive: true,
    });
  }
  await symlink(
    path.join(root, "node_modules"),
    path.join(scratchApp, "node_modules"),
    "dir",
  );
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = "http://127.0.0.1:" + port;
  const log = openSync(path.join(scratch, "server.log"), "w");
  const R2_SECRET_ACCESS_KEY = password;
  const CODE_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: scratchApp,
      stdio: ["ignore", log, log],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: tmpdir(),
        NEXT_TELEMETRY_DISABLED: "1",
        DATABASE_PROVIDER: "pg",
        DATABASE_URL,
        R2_ENDPOINT: endpoint,
        R2_REGION: "us-east-1",
        R2_ACCESS_KEY_ID: "e2e-local",
        R2_SECRET_ACCESS_KEY,
        OTA_STORAGE_BUCKET: "ota-fixtures",
        S3_FORCE_PATH_STYLE: "true",
        OTA_PUBLIC_BASE_URL: origin,
        CODE_SIGNING_PRIVATE_KEY,
      },
    },
  );
  closeSync(log);
  await ready(async () => {
    if (!(await fetch(origin + "/api/health")).ok) throw new Error("Unhealthy");
  }, "HTTP server startup");
  const fixture = { origin, db, storage, password, publicKey, old };
  await exerciseDelivery(fixture);
  await exerciseClientLifecycle({ ...fixture, scratch });
  await exerciseConsole(fixture);
  await checkRegistrarToken(origin, DATABASE_URL, scratchApp);
  console.log("PASS signed OTA HTTP and browser workflows");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    await stopped;
  }
  storage?.destroy();
  await db?.end();
  for (const id of containers) docker("rm", "-f", id);
  await rm(scratch, { recursive: true, force: true });
}
