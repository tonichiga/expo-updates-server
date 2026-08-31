export function signRSASHA256(data, privateKey) {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data, "utf8");
  sign.end();
  return sign.sign(privateKey, "base64");
}

export async function getPrivateKeyAsync() {
  const privateKeyPath = process.env.PRIVATE_KEY_PATH;
  if (!privateKeyPath) {
    return null;
  }
}

export function buildRequestContext({
  channel,
  runtimeVersion,
  platform,
  updateId,
  createdAtPath,
  buildId,
} = {}) {
  return `channel=${channel || "unknown"} runtime=${runtimeVersion || "unknown"} platform=${platform || "unknown"} date=${createdAtPath || "unknown"} updateId=${updateId || buildId || "unknown"}`;
}
