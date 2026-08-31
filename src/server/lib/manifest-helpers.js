import path from "path";
import crypto from "crypto";
import { Buffer } from "buffer";
import { supabase, SUPABASE_BUCKET, SIGNED_URL_TTL } from "./supabase.js";

const SIGNED_URL_RETRIES = parseInt(
  process.env.OTA_SIGNED_URL_RETRIES ||
    process.env.SUPABASE_SIGNED_URL_RETRIES ||
    "3",
  10,
);
const SIGNED_URL_RETRY_DELAY_MS = parseInt(
  process.env.OTA_SIGNED_URL_RETRY_DELAY_MS ||
    process.env.SUPABASE_SIGNED_URL_RETRY_DELAY_MS ||
    "250",
  10,
);

function createHash(file, hashingAlgorithm, encoding) {
  return crypto.createHash(hashingAlgorithm).update(file).digest(encoding);
}

function convertSHA256HashToUUID(value) {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep);
}

async function downloadJsonFromStorage(storagePath) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .download(storagePath);

  if (error) {
    console.error(
      `[${new Date().toLocaleTimeString()}] ⚠️ Download error for ${storagePath}:`,
      error,
    );
    throw new Error(
      `Failed to download ${storagePath}: ${error.message || JSON.stringify(error)}`,
    );
  }

  if (!data) {
    throw new Error(`No data returned for ${storagePath}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return JSON.parse(Buffer.from(arrayBuffer).toString("utf-8"));
}

async function createSignedUrl(storagePath) {
  for (let attempt = 1; attempt <= SIGNED_URL_RETRIES; attempt += 1) {
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL);

    if (!error) {
      return data.signedUrl;
    }

    const message = error.message || "Unknown error";
    const isRetryable =
      message.includes("Bad Gateway") ||
      message.includes("Gateway Timeout") ||
      message.includes("Service Unavailable") ||
      message.includes("Internal Server Error");

    if (!isRetryable || attempt === SIGNED_URL_RETRIES) {
      throw new Error(`Failed to sign ${storagePath}: ${message}`);
    }

    const delayMs = SIGNED_URL_RETRY_DELAY_MS * attempt;
    console.warn(
      `[${new Date().toLocaleTimeString()}] ⚠️ createSignedUrl retry ${attempt}/${SIGNED_URL_RETRIES} for ${storagePath} after ${delayMs}ms: ${message}`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Failed to sign ${storagePath}: exhausted retries`);
}

export {
  createHash,
  convertSHA256HashToUUID,
  toPosixPath,
  downloadJsonFromStorage,
  createSignedUrl,
};
