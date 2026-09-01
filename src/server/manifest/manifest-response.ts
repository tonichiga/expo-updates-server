import NodeFormData from "form-data";
import { NextRequest } from "next/server";
import { toPosixPath } from "../lib/manifest-helpers.js";
import { createSignatureHeaderIfRequested } from "../lib/signing.js";

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  json: "application/json",
  js: "application/javascript",
  hbc: "application/octet-stream",
};

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function removeTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase();
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function getServerBaseUrl(request: NextRequest): string {
  const envBaseUrl = process.env.OTA_PUBLIC_BASE_URL?.trim();
  if (envBaseUrl) {
    return removeTrailingSlash(envBaseUrl);
  }

  const host =
    firstForwardedValue(request.headers.get("x-forwarded-host")) ||
    request.headers.get("host") ||
    request.nextUrl.host;
  const forwardedProto = firstForwardedValue(
    request.headers.get("x-forwarded-proto"),
  );
  let protocol =
    forwardedProto || request.nextUrl.protocol.replace(":", "") || "http";

  if (protocol !== "http" && protocol !== "https") {
    protocol = protocol.includes("https") ? "https" : "http";
  }

  if (protocol === "http" && !isLocalHost(host)) {
    protocol = "https";
  }

  return `${protocol}://${host}`;
}

export function buildAssetUrl({
  request,
  runtimeVersion,
  platform,
  createdAtPath,
  channel,
  updateId,
  assetPath,
}: {
  request: NextRequest;
  runtimeVersion: string;
  platform: string;
  createdAtPath: string;
  channel: string;
  updateId: string;
  assetPath: string;
}): string {
  const params = new URLSearchParams({
    runtimeVersion,
    platform,
    createdAtPath,
    channel,
    updateId,
    assetPath: toPosixPath(assetPath),
  });
  return `${getServerBaseUrl(request)}/api/assets?${params.toString()}`;
}

export function createSignatureRequest(request: NextRequest) {
  return {
    headers: {
      "expo-expect-signature": request.headers.get("expo-expect-signature"),
    },
  };
}

export function createMultipartResponse({
  protocolVersion,
  boundary,
  buffer,
}: {
  protocolVersion: number;
  boundary: string;
  buffer: Uint8Array;
}) {
  const body = new Uint8Array(buffer.byteLength);
  body.set(buffer);

  return new Response(body.buffer, {
    status: 200,
    headers: {
      "expo-protocol-version": String(protocolVersion),
      "expo-sfv-version": "0",
      "cache-control": "private, max-age=0",
      "content-type": `multipart/mixed; boundary=${boundary}`,
    },
  });
}

export async function createNoUpdateResponse(
  request: NextRequest,
  protocolVersion: number,
) {
  const directiveString = JSON.stringify({ type: "noUpdateAvailable" });
  let signature: string | null = null;

  try {
    signature = await createSignatureHeaderIfRequested(
      createSignatureRequest(request),
      directiveString,
    );
  } catch (signatureError: unknown) {
    return Response.json(
      { error: (signatureError as Error).message },
      { status: 400 },
    );
  }

  const form = new NodeFormData();
  form.append("directive", directiveString, {
    contentType: "application/json",
    header: {
      "content-type": "application/json; charset=utf-8",
      ...(signature ? { "expo-signature": signature } : {}),
    },
  });

  return createMultipartResponse({
    protocolVersion,
    boundary: form.getBoundary(),
    buffer: new Uint8Array(form.getBuffer()),
  });
}

export function normalizeFileExtension(
  fileExtension: string | undefined,
  metadataExt: string | undefined,
): string | undefined {
  const rawValue = fileExtension?.trim() || metadataExt?.trim() || "";
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.startsWith(".")
    ? rawValue.toLowerCase()
    : `.${rawValue.toLowerCase()}`;

  return normalized === "." ? undefined : normalized;
}

export function normalizeContentType(
  contentType: string | undefined,
  fileExtension: string | undefined,
  isLaunchAsset: boolean,
): string {
  if (isLaunchAsset) {
    return "application/javascript";
  }

  if (contentType && contentType !== "application/octet-stream") {
    return contentType;
  }

  const normalizedExt = fileExtension?.replace(/^\./, "").toLowerCase();
  if (normalizedExt && CONTENT_TYPE_BY_EXTENSION[normalizedExt]) {
    return CONTENT_TYPE_BY_EXTENSION[normalizedExt];
  }

  return contentType || "application/octet-stream";
}

export function createExpoClientConfig(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!value) {
    console.warn(
      `[${new Date().toLocaleTimeString()}] ⚠️ Missing or invalid expoClient config in update-info.json. Returning null expoClient config.`,
    );
    return null;
  }

  const ios =
    value.ios && typeof value.ios === "object"
      ? (value.ios as Record<string, unknown>)
      : {};
  const android =
    value.android && typeof value.android === "object"
      ? (value.android as Record<string, unknown>)
      : {};

  return {
    ...value,
    scheme: value.scheme,
    ios: { ...ios },
    android: { ...android },
  };
}
