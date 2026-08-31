import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import { contentType, listFiles } from "../lib/common.mjs";
import { withRetry } from "../lib/retry.mjs";
import { requiredEnv } from "../shared/config.mjs";

export function createStorageClient() {
  return new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint: requiredEnv("R2_ENDPOINT"),
    forcePathStyle: ["true", "1"].includes(
      (process.env.S3_FORCE_PATH_STYLE || "false").toLowerCase(),
    ),
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export async function uploadObject(storage, input) {
  await withRetry(`Upload ${input.key}`, () =>
    storage.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    ),
  );
}

export async function uploadDirectory(
  storage,
  bucket,
  outputDir,
  basePath,
) {
  const files = await listFiles(outputDir);
  for (const filePath of files) {
    const relativePath = path
      .relative(outputDir, filePath)
      .split(path.sep)
      .join("/");
    if (relativePath === "update-meta.json") {
      continue;
    }
    await uploadObject(storage, {
      bucket,
      key: `${basePath}/${relativePath}`,
      body: await fs.promises.readFile(filePath),
      contentType: contentType(relativePath, false),
    });
  }
}
