import { createHash, randomBytes, randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Environment may already be provided by Docker or the deployment platform.
}

const SUPPORTED_SCOPES = new Set([
  "updates:read",
  "updates:write",
  "redirects:read",
  "redirects:write",
]);

function parseScopes(value) {
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (
    scopes.length === 0 ||
    scopes.some((scope) => !SUPPORTED_SCOPES.has(scope))
  ) {
    throw new Error(
      "Scopes must be a comma-separated list of supported values.",
    );
  }
  return [...new Set(scopes)];
}

async function insertToken(row) {
  const provider = (
    process.env.DATABASE_PROVIDER ||
    process.env.DB_PROVIDER ||
    "pg"
  ).toLowerCase();

  if (provider === "supabase") {
    const url = process.env.SUPABASE_PROJECT_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
      );
    }
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.from("ota_access_tokens").insert(row);
    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const sslEnabled = ["true", "1", "require"].includes(
    (process.env.DATABASE_SSL || "false").toLowerCase(),
  );
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query(
      `INSERT INTO ota_access_tokens (
        id, name, token_prefix, token_hash, scopes, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.id,
        row.name,
        row.token_prefix,
        row.token_hash,
        JSON.stringify(row.scopes),
        row.expires_at,
      ],
    );
  } finally {
    await pool.end();
  }
}

async function main() {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const name = (await terminal.question("Token name [mobile-builds]: "))
      .trim() || "mobile-builds";
    if (name.length > 100) {
      throw new Error("Token name must contain at most 100 characters.");
    }

    const scopes = parseScopes(
      (await terminal.question("Scopes [updates:write]: ")).trim() ||
        "updates:write",
    );
    const expiresInput = (
      await terminal.question(
        "Expiration as ISO date, or leave empty for no expiration: ",
      )
    ).trim();
    const expiresAt = expiresInput
      ? new Date(expiresInput).toISOString()
      : null;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      throw new Error("Expiration must be in the future.");
    }

    const token = `ota_${randomBytes(32).toString("base64url")}`;
    await insertToken({
      id: randomUUID(),
      name,
      token_prefix: token.slice(0, 12),
      token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
      scopes,
      expires_at: expiresAt,
    });

    console.log("\nAccess token created. Copy it now; it is shown only once:");
    console.log(token);
  } finally {
    terminal.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
