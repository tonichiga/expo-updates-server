import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(ROOT_DIR, ".env.ota"));

function parseJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readPath(value, paths) {
  for (const keys of paths) {
    let current = value;
    for (const key of keys) {
      if (!current || typeof current !== "object" || !(key in current)) {
        current = null;
        break;
      }
      current = current[key];
    }
    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
    if (typeof current === "number" && Number.isFinite(current)) {
      return current;
    }
  }

  return null;
}

function normalizeDate(value, fallbackDate) {
  if (typeof value === "number") {
    const milliseconds = value > 100_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return fallbackDate.toISOString();
}

export function parseEmbeddedManifest(content, fallbackDate = new Date()) {
  let root = parseJson(content);
  root = parseJson(root);
  if (!root || typeof root !== "object") {
    throw new Error("app.manifest does not contain valid JSON");
  }

  const nested = parseJson(root.manifest);
  const manifest = nested && typeof nested === "object" ? nested : root;
  const embeddedUpdateId = readPath(manifest, [
    ["id"],
    ["updateId"],
    ["embeddedUpdateId"],
    ["metadata", "updateId"],
    ["extra", "expoClient", "id"],
  ]);
  const createdAt = readPath(manifest, [
    ["createdAt"],
    ["commitTime"],
    ["publishedTime"],
    ["metadata", "createdAt"],
    ["extra", "expoClient", "createdAt"],
  ]);
  const appVersion =
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
  const fallbackId = crypto
    .createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, 32);

  return {
    embeddedUpdateId:
      embeddedUpdateId ||
      `${fallbackId.slice(0, 8)}-${fallbackId.slice(8, 12)}-4${fallbackId.slice(13, 16)}-a${fallbackId.slice(17, 20)}-${fallbackId.slice(20)}`,
    appVersion: typeof appVersion === "string" ? appVersion : null,
    createdAt: normalizeDate(createdAt, fallbackDate),
  };
}

export function readExpoAppVersion(appRoot, readFile = fs.readFileSync) {
  try {
    const appJson = JSON.parse(
      readFile(path.join(appRoot, "app.json"), "utf8"),
    );
    const appVersion = appJson?.expo?.version;
    return typeof appVersion === "string" && appVersion.trim()
      ? appVersion.trim()
      : null;
  } catch {
    return null;
  }
}

export function parseEmbeddedManifestForProject(
  content,
  appRoot,
  fallbackDate = new Date(),
  readFile = fs.readFileSync,
) {
  const fields = parseEmbeddedManifest(content, fallbackDate);
  return {
    ...fields,
    appVersion: fields.appVersion || readExpoAppVersion(appRoot, readFile),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key?.startsWith("--")) {
      args[key.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readChannel(appRoot, explicitChannel) {
  const configuredChannel =
    explicitChannel || process.env.EXPO_UPDATE_CHANNEL;
  if (configuredChannel) {
    return configuredChannel.trim().toLowerCase();
  }

  const appJson = JSON.parse(
    fs.readFileSync(path.join(appRoot, "app.json"), "utf8"),
  );
  return String(
    appJson.expo?.updates?.requestHeaders?.["expo-channel-name"] ||
      appJson.expo?.extra?.updateChannel ||
      "production",
  )
    .trim()
    .toLowerCase();
}

function getRegistrationUrl() {
  if (process.env.OTA_EMBEDDED_REGISTER_URL) {
    return process.env.OTA_EMBEDDED_REGISTER_URL;
  }
  if (!process.env.OTA_SERVER_URL) {
    return null;
  }

  const url = new URL(process.env.OTA_SERVER_URL);
  url.pathname = `${url.pathname.replace(/\/api\/manifest\/?$/, "").replace(/\/+$/, "")}/api/admin/embedded-updates`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function registerWithHttp(input) {
  const url = getRegistrationUrl();
  const accessToken = process.env.OTA_ACCESS_TOKEN;
  if (!url || !accessToken) {
    return false;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `Embedded registration failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return true;
}

async function registerWithDatabase(input) {
  const connectionString = process.env.OTA_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Set OTA_ACCESS_TOKEN with OTA_SERVER_URL, or set OTA_DATABASE_URL.",
    );
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString,
    ssl:
      process.env.OTA_DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO ota_embedded_updates (
        embedded_update_id, app_version, created_at, channel, platform, is_embedded
      ) VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (embedded_update_id) DO UPDATE SET
        app_version = COALESCE(
          NULLIF(BTRIM(EXCLUDED.app_version), ''),
          ota_embedded_updates.app_version
        ),
        created_at = EXCLUDED.created_at,
        channel = EXCLUDED.channel,
        platform = EXCLUDED.platform,
        is_embedded = true,
        modified_at = now()`,
      [
        input.embeddedUpdateId,
        input.appVersion || null,
        input.createdAt,
        input.channel,
        input.platform,
      ],
    );
  } finally {
    await client.end();
  }
}

export async function registerEmbeddedUpdate(input) {
  if (!CHANNEL_PATTERN.test(input.channel)) {
    throw new Error("Invalid Expo update channel");
  }
  if (input.platform !== "ios" && input.platform !== "android") {
    throw new Error("--platform must be ios or android");
  }

  if (!(await registerWithHttp(input))) {
    await registerWithDatabase(input);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    throw new Error("--manifest is required");
  }

  const manifestPath = path.resolve(args.manifest);
  const channel = readChannel(ROOT_DIR, args.channel);
  const fields = parseEmbeddedManifestForProject(
    fs.readFileSync(manifestPath, "utf8"),
    ROOT_DIR,
    fs.statSync(manifestPath).mtime,
  );
  const input = {
    ...fields,
    channel,
    platform: String(args.platform || "").toLowerCase(),
  };

  await registerEmbeddedUpdate(input);
  console.log(
    `Registered embedded update ${input.embeddedUpdateId} (${input.platform}, ${input.channel}).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Embedded update registration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
