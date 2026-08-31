import crypto from "crypto";
import { readFile } from "node:fs/promises";

function serializeSignatureHeader(signature, keyId = "main") {
  return `sig="${signature}", keyid="${keyId}"`;
}

function signRSASHA256(data, privateKey) {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data, "utf8");
  sign.end();
  return sign.sign(privateKey, "base64");
}

async function getPrivateKey() {
  const inlineKey = process.env.CODE_SIGNING_PRIVATE_KEY?.trim();
  if (inlineKey) {
    return inlineKey.replaceAll("\\n", "\n");
  }

  const keyPath = process.env.CODE_SIGNING_PRIVATE_KEY_PATH?.trim();
  if (!keyPath) {
    return null;
  }

  return readFile(keyPath, "utf8");
}

async function createSignatureHeaderIfRequested(req, payloadString) {
  const expectSignatureHeader = req.headers["expo-expect-signature"];
  console.log(
    `[${new Date().toLocaleTimeString()}] 📋 expo-expect-signature header: ${expectSignatureHeader || "not present"}`,
  );
  if (!expectSignatureHeader) {
    return null;
  }

  console.log(
    `[${new Date().toLocaleTimeString()}] 🔐 Signature requested, loading private key...`,
  );
  const privateKey = await getPrivateKey();
  if (!privateKey) {
    throw new Error(
      "Code signing requested but no key supplied when starting server.",
    );
  }

  const hashSignature = signRSASHA256(payloadString, privateKey);
  console.log(
    `[${new Date().toLocaleTimeString()}] ✍️  Signature generated: ${hashSignature.substring(0, 50)}...`,
  );
  return serializeSignatureHeader(hashSignature, "main");
}

export { createSignatureHeaderIfRequested };
