import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Environment may already be provided by the shell.
}

async function main() {
  const provider = (
    process.env.DATABASE_PROVIDER ||
    process.env.DB_PROVIDER ||
    "pg"
  ).toLowerCase();
  const databaseUrl = process.env.DATABASE_URL;
  if (provider !== "supabase" && !databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const configPath = path.resolve(
    process.env.OTA_EMERGENCY_REDIRECT_CONFIG_PATH ||
      "config/ota-emergency-channel-redirects.json",
  );
  const rules = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!Array.isArray(rules)) {
    throw new Error("Emergency redirect config must contain an array.");
  }

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
    for (const rule of rules) {
      const { error } = await client.from("ota_emergency_redirects").upsert(
        {
          name: rule.id,
          enabled: rule.enabled,
          embedded_update_id: rule.embeddedUpdateId,
          runtime_version: rule.runtimeVersion,
          platform: rule.platform,
          from_channel: rule.fromChannel,
          to_channel: rule.toChannel,
          target_mode: rule.targetMode,
          expected_update_id: rule.expectedUpdateId || null,
          modified_at: new Date().toISOString(),
        },
        {
          onConflict:
            "embedded_update_id,runtime_version,platform,from_channel",
        },
      );
      if (error) {
        throw new Error(error.message);
      }
    }
  } else {
    const sslEnabled = ["true", "1", "require"].includes(
      (process.env.DATABASE_SSL || "false").toLowerCase(),
    );
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    });

    try {
      for (const rule of rules) {
        await pool.query(
          `insert into public.ota_emergency_redirects (
             name,
             enabled,
             embedded_update_id,
             runtime_version,
             platform,
             from_channel,
             to_channel,
             target_mode,
             expected_update_id
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (
             embedded_update_id,
             runtime_version,
             platform,
             from_channel
           ) do update set
             name = excluded.name,
             enabled = excluded.enabled,
             to_channel = excluded.to_channel,
             target_mode = excluded.target_mode,
             expected_update_id = excluded.expected_update_id,
             modified_at = now()`,
          [
            rule.id,
            rule.enabled,
            rule.embeddedUpdateId,
            rule.runtimeVersion,
            rule.platform,
            rule.fromChannel,
            rule.toChannel,
            rule.targetMode,
            rule.expectedUpdateId || null,
          ],
        );
      }
    } finally {
      await pool.end();
    }
  }

  console.log(`Imported ${rules.length} emergency redirect rule(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
