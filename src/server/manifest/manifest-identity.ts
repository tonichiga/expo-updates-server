import { createHash } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** UUID v5: the channel publication epoch is the namespace, the artifact is the name. */
export function createServedManifestId(
  channelEpoch: string | null | undefined,
  updateId: string,
): string {
  if (!channelEpoch || !UUID_PATTERN.test(channelEpoch) || !UUID_PATTERN.test(updateId)) {
    throw new Error("A valid channel epoch and update UUID are required to serve a manifest.");
  }

  const namespace = Buffer.from(channelEpoch.replaceAll("-", ""), "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(updateId.toLowerCase(), "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
