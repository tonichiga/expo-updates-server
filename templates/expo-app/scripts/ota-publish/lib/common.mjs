import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CONTENT_TYPES = {
  bundle: "application/javascript",
  hbc: "application/octet-stream",
  js: "application/javascript",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  otf: "font/otf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function normalizeExtension(filePath, explicitExtension) {
  return String(explicitExtension || path.extname(filePath))
    .replace(/^\./, "")
    .toLowerCase();
}

export function contentType(filePath, isLaunchAsset, explicitExtension) {
  if (isLaunchAsset) {
    return "application/javascript";
  }
  const extension = normalizeExtension(filePath, explicitExtension);
  return CONTENT_TYPES[extension] || "application/octet-stream";
}

export function base64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function datePath(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid createdAt value: ${iso}`);
  }
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

export async function assetMetadata(
  outputDir,
  filePath,
  isLaunchAsset,
  extension,
) {
  const content = await fs.promises.readFile(path.join(outputDir, filePath));
  const normalizedExtension = normalizeExtension(filePath, extension);
  return {
    path: filePath.split(path.sep).join("/"),
    hash: base64Url(
      crypto.createHash("sha256").update(content).digest("base64"),
    ),
    key: crypto.createHash("md5").update(content).digest("hex"),
    contentType: contentType(filePath, isLaunchAsset, extension),
    isLaunchAsset,
    ...(isLaunchAsset
      ? { fileExtension: ".bundle" }
      : normalizedExtension
        ? { fileExtension: `.${normalizedExtension}` }
        : {}),
  };
}

export async function listFiles(directory) {
  const entries = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }),
  );
  return nested.flat();
}
