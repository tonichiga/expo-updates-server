import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import {
  createDatabasePool,
  writeDatabaseRecords,
} from "./api/database-client.mjs";
import {
  createStorageClient,
  uploadDirectory,
  uploadObject,
} from "./api/storage-client.mjs";
import {
  assetMetadata,
  datePath,
} from "./lib/common.mjs";
import { getExpoExportCommand } from "./lib/expo-export-command.mjs";
import { loadPublishConfig } from "./shared/config.mjs";

dotenv.config({ path: ".env.ota" });

function parseArgs(argv) {
  const options = { platform: "all", message: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--platform" || argument === "--message") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      options[argument.slice(2)] = value.trim();
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["all", "ios", "android"].includes(options.platform)) {
    throw new Error("--platform must be all, ios or android.");
  }
  if (!options.message) {
    throw new Error("--message is required.");
  }
  return options;
}

async function publishPlatform({
  appJson,
  appVersion,
  bucket,
  channel,
  message,
  platform,
  pool,
  runtimeVersion,
  storage,
}) {
  const outputDir = path.resolve(".ota-dist", platform);
  fs.rmSync(outputDir, { recursive: true, force: true });
  const exportCommand = getExpoExportCommand({ outputDir, platform });
  execFileSync(exportCommand.command, exportCommand.args, {
    stdio: "inherit",
    env: process.env,
  });

  const metadataPath = path.join(outputDir, "metadata.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const platformMetadata = metadata.fileMetadata?.[platform];
  if (!platformMetadata?.bundle) {
    throw new Error(`Expo metadata is missing the ${platform} bundle.`);
  }

  const createdAt = new Date().toISOString();
  const createdAtPath = datePath(createdAt);
  const updateId = crypto.randomUUID();
  Object.assign(metadata, {
    runtimeVersion,
    createdAt,
    createdAtPath,
    updateId,
  });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const assets = await Promise.all(
    (platformMetadata.assets || []).map((asset) =>
      assetMetadata(outputDir, asset.path, false, asset.ext),
    ),
  );
  const launchAsset = await assetMetadata(
    outputDir,
    platformMetadata.bundle,
    true,
  );
  const basePath = `${runtimeVersion}/${platform}/${createdAtPath}/${channel}/${updateId}`;
  const update = {
    id: updateId,
    appVersion,
    runtimeVersion,
    channel,
    comment: message,
    createdAt,
    createdAtPath,
    buildId: updateId,
    platform,
    assets,
    launchAsset,
    storageBucket: bucket,
    storageBasePath: basePath,
    expoClient: {
      ...(appJson.expo || {}),
      updates: undefined,
      hooks: undefined,
      plugins: undefined,
    },
  };
  const latest = {
    id: updateId,
    updateId,
    buildId: updateId,
    runtimeVersion,
    channel,
    comment: message,
    platform,
    createdAt,
    createdAtPath,
  };

  fs.writeFileSync(
    path.join(outputDir, "update-info.json"),
    `${JSON.stringify(update, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, "update-meta.json"),
    `${JSON.stringify(
      { isActive: false, updatedAt: null, disabledAt: createdAt },
      null,
      2,
    )}\n`,
  );

  await uploadDirectory(storage, bucket, outputDir, basePath);
  const latestBody = JSON.stringify(latest, null, 2);
  await uploadObject(storage, {
    bucket,
    key: `${runtimeVersion}/${platform}/channels/${channel}/latest.json`,
    body: latestBody,
    contentType: "application/json",
  });
  await uploadObject(storage, {
    bucket,
    key: `${runtimeVersion}/${platform}/latest.json`,
    body: latestBody,
    contentType: "application/json",
  });
  await writeDatabaseRecords(pool, update, latest);

  console.log(
    `Published inactive ${platform} update ${updateId} for ${channel}/${runtimeVersion}.`,
  );
}

const options = parseArgs(process.argv.slice(2));
const config = loadPublishConfig();
const platforms =
  options.platform === "all" ? ["android", "ios"] : [options.platform];
const storage = createStorageClient();
const pool = createDatabasePool();

try {
  for (const platform of platforms) {
    await publishPlatform({
      ...config,
      message: options.message,
      platform,
      pool,
      storage,
    });
  }
} finally {
  await pool.end();
}

console.log("Publish completed. Activate the update in the admin panel.");
