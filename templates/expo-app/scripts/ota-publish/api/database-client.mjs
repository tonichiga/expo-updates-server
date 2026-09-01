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
          id, update_id, build_id, app_version, runtime_version, channel, platform,
          created_at, created_at_path, storage_bucket, storage_base_path,
          is_active, disabled_at, assets_count, launch_asset_path, comment,
          manifest
        ) VALUES (
          $1, $1, $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          false, $6, $10, $11, $12,
          $13::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          app_version = EXCLUDED.app_version,
          runtime_version = EXCLUDED.runtime_version,
          channel = EXCLUDED.channel,
          platform = EXCLUDED.platform,
          created_at = EXCLUDED.created_at,
          created_at_path = EXCLUDED.created_at_path,
          storage_bucket = EXCLUDED.storage_bucket,
          storage_base_path = EXCLUDED.storage_base_path,
          is_active = false,
          disabled_at = EXCLUDED.disabled_at,
          assets_count = EXCLUDED.assets_count,
          launch_asset_path = EXCLUDED.launch_asset_path,
          comment = EXCLUDED.comment,
          manifest = EXCLUDED.manifest`,
        [
          update.id,
          update.appVersion,
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
      await client.query(
        `INSERT INTO ota_update_channels (
          runtime_version, channel, platform,
          latest_update_id, latest_created_at, latest_created_at_path
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (runtime_version, channel, platform) DO UPDATE SET
          latest_update_id = EXCLUDED.latest_update_id,
          latest_created_at = EXCLUDED.latest_created_at,
          latest_created_at_path = EXCLUDED.latest_created_at_path`,
        [
          latest.runtimeVersion,
          latest.channel,
          latest.platform,
          latest.updateId,
          latest.createdAt,
          latest.createdAtPath,
        ],
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
