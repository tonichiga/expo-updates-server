import pg from "pg";
import { withRetry } from "../lib/retry.mjs";
import { requiredEnv } from "../shared/config.mjs";

export function createDatabasePool() {
  const sslValue = (process.env.OTA_DATABASE_SSL || "true").toLowerCase();
  return new pg.Pool({
    connectionString: requiredEnv("OTA_DATABASE_URL"),
    ssl: ["false", "0"].includes(sslValue)
      ? false
      : { rejectUnauthorized: false },
  });
}

export async function writeDatabaseRecords(pool, update, latest) {
  await withRetry(`Database publish ${update.id}`, async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ota_updates (
          id, update_id, build_id, runtime_version, channel, platform,
          created_at, created_at_path, storage_bucket, storage_base_path,
          is_active, disabled_at, assets_count, launch_asset_path, comment,
          manifest
        ) VALUES (
          $1, $1, $1, $2, $3, $4,
          $5, $6, $7, $8,
          false, $5, $9, $10, $11,
          $12::jsonb
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          update.id,
          update.runtimeVersion,
          update.channel,
          update.platform,
          update.createdAt,
          update.createdAtPath,
          update.storageBucket,
          update.storageBasePath,
          update.assets.length,
          update.launchAsset.path,
          update.comment,
          JSON.stringify(update),
        ],
      );
      // Retrying a publication must never disable an activated artifact or
      // move serving pointers. A new scope starts empty until activation.
      await client.query(
        `INSERT INTO ota_update_channels (runtime_version, channel, platform)
         VALUES ($1, $2, $3)
         ON CONFLICT (runtime_version, channel, platform) DO NOTHING`,
        [latest.runtimeVersion, latest.channel, latest.platform],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
