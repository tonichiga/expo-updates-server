// Self-contained so the same read-only probes can run inside the existing app container.
// Never return raw exceptions, connection strings, tokens or PEM material.
export async function probeServer({ env, timeout = 5000, network = true }) {
  const checks = [];
  const add = (id, status, message, remedy) => checks.push({ id, status, message, ...(remedy ? { remedy } : {}) });
  const present = (value) => typeof value === 'string' && value.trim() && !/(?:<[^>]+>|replace-with|YOUR_|choose-a-|:\/\/USER:PASSWORD@HOST|:\/\/user:password@host|updates\.example\.com|storage\.example\.com)/.test(value);
  const endpoint = (value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && present(value);
    } catch { return false; }
  };
  const bucket = env.OTA_STORAGE_BUCKET || env.R2_BUCKET || env.SUPABASE_UPDATES_BUCKET || 'expo-updates';
  let keyFingerprint;
  try {
    const crypto = await import('node:crypto');
    const fs = await import('node:fs/promises');
    const pem = env.CODE_SIGNING_PRIVATE_KEY?.trim()
      ? env.CODE_SIGNING_PRIVATE_KEY.replaceAll('\\n', '\n')
      : await fs.readFile(env.CODE_SIGNING_PRIVATE_KEY_PATH, 'utf8');
    const key = crypto.createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('unsupported');
    keyFingerprint = crypto.createHash('sha256').update(crypto.createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex');
    add('signing.key', 'pass', 'RSA signing key is readable and valid (at least 2048 bits).');
  } catch {
    add('signing.key', 'fail', 'Signing key is missing, unreadable or invalid.', 'Set CODE_SIGNING_PRIVATE_KEY or CODE_SIGNING_PRIVATE_KEY_PATH. For Docker check the mount and read permission for container UID/GID 1001.');
  }
  const publicUrl = endpoint(env.OTA_PUBLIC_BASE_URL) ? env.OTA_PUBLIC_BASE_URL : undefined;
  add('server.url', publicUrl ? 'pass' : 'fail', publicUrl ? 'Public server URL is configured.' : 'Public server URL is missing, a placeholder or invalid.', publicUrl ? undefined : 'Set OTA_PUBLIC_BASE_URL to your server URL without credentials, query or fragment.');
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      add('server.phone-url', 'warn', 'HTTP or loopback URL needs special device network/native configuration.', 'Use a phone-reachable HTTPS URL. localhost on a phone points to the phone; host connectivity cannot prove device connectivity.');
    }
  }
  const provider = (env.DATABASE_PROVIDER || env.DB_PROVIDER || 'pg').toLowerCase();
  if (!['pg', 'supabase'].includes(provider)) {
    add('database.config', 'fail', 'Unsupported database provider.', 'Set DATABASE_PROVIDER to pg or supabase.');
    return { checks, keyFingerprint, publicUrl };
  }
  const supabaseUrl = env.SUPABASE_PROJECT_URL || env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  let databaseConfigured = false;
  if (provider === 'pg') {
    try {
      const url = new URL(env.DATABASE_URL);
      databaseConfigured = ['postgres:', 'postgresql:'].includes(url.protocol) && present(env.DATABASE_URL) && Boolean(url.hostname && url.username && url.password && url.pathname.length > 1) && [...url.searchParams.keys()].every((key) => key === 'sslmode');
    } catch { /* Report only a fixed message below. */ }
  } else databaseConfigured = endpoint(supabaseUrl) && Boolean(present(supabaseKey));
  add('database.config', databaseConfigured ? 'pass' : 'fail', databaseConfigured ? 'Database credentials are configured.' : 'Database configuration is missing or invalid.', databaseConfigured ? undefined : 'For pg set DATABASE_URL including an explicit user/password (percent-encoded); only sslmode is supported in URL query parameters and ambient PG credentials are not used. For Supabase set SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const storageConfigured = provider === 'supabase'
    ? databaseConfigured
    : endpoint(env.R2_ENDPOINT) && Boolean(present(env.R2_ACCESS_KEY_ID) && present(env.R2_SECRET_ACCESS_KEY));
  add('storage.config', storageConfigured ? 'pass' : 'fail', storageConfigured ? 'Storage credentials are configured.' : 'Storage configuration is missing or invalid.', storageConfigured ? undefined : 'Set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (or Supabase service credentials).');
  if (!network) {
    add('database.connection', 'skip', 'Database/schema connectivity not checked in offline mode.');
    add('storage.bucket', 'skip', 'Bucket reachability not checked in offline mode.');
    return { checks, keyFingerprint, publicUrl };
  }
  if (databaseConfigured && provider === 'pg') {
    let client;
    try {
      const { default: pg } = await import('pg');
      const databaseUrl = new URL(env.DATABASE_URL);
      databaseUrl.port ||= '5432';
      client = new pg.Client({ connectionString: databaseUrl.toString(), application_name: 'ota-doctor', replication: 'false', client_encoding: 'utf8',
        ssl: ['true', '1', 'require'].includes((env.DATABASE_SSL || '').toLowerCase()) ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: timeout, query_timeout: timeout, statement_timeout: timeout,
        options: '-c default_transaction_read_only=on' });
      // A connection-level error after a query timeout must not become an unhandled event.
      client.on('error', () => {});
      await client.connect();
      await client.query('SELECT 1');
      add('database.connection', 'pass', 'Database is reachable with the configured credentials.');
      try {
        await client.query('SELECT id, audience_mode, audience_device_ids FROM public.ota_updates LIMIT 0');
        await client.query('SELECT installation_id, device_id, reported_update_id FROM public.ota_device_state LIMIT 0');
        await client.query('SELECT * FROM public.ota_named_devices LIMIT 0');
        const result = await client.query(`SELECT
          to_regclass('public.ota_embedded_updates') IS NOT NULL
          AND to_regclass('public.ota_admin_users') IS NOT NULL
          AND to_regclass('public.ota_device_activity_daily') IS NOT NULL
          AND to_regclass('public.ota_device_activity_cohorts') IS NOT NULL
          AND to_regclass('public.ota_device_analytics_metadata') IS NOT NULL
          AND to_regclass('public.ota_distribution_control') IS NOT NULL
          AND to_regclass('public.ota_distribution_control_events') IS NOT NULL
          AND to_regprocedure('public.ota_record_heartbeat(jsonb)') IS NOT NULL
          AND to_regprocedure('public.ota_latest_eligible_update(text,text,text,text,text)') IS NOT NULL
          AND to_regprocedure('public.ota_replace_audience(uuid,text,jsonb,jsonb,integer)') IS NOT NULL
          AND to_regprocedure('public.ota_devices_report_v2(integer,text,text,text,integer,text,text)') IS NOT NULL
          AND to_regprocedure('public.assert_ota_distribution_mutation_allowed(text)') IS NOT NULL
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ota_updates'::regclass
            AND tgname = 'trg_ota_updates_activate_audience' AND tgenabled IN ('O','A')
            AND tgfoid = to_regprocedure('public.ota_activate_audience()')) AS ready`);
        if (!result.rows[0]?.ready) throw new Error('schema');
        add('database.schema', 'pass', 'Core OTA, telemetry and targeting schema is accessible.');
      } catch {
        add('database.schema', 'fail', 'Core OTA schema is missing, outdated or inaccessible.', 'Review database permissions and apply the project schema/migrations after backing up existing data.');
      }
    } catch {
      add('database.connection', 'fail', 'Database connection failed or timed out.', 'Check DATABASE_URL, SSL, network, credentials and installed pg dependency.');
    } finally { if (client) await client.end().catch(() => {}); }
  } else if (databaseConfigured) {
    try {
      const selections = ['ota_updates?select=id,audience_mode,audience_device_ids&limit=0', 'ota_device_state?select=installation_id,device_id,reported_update_id&limit=0', 'ota_named_devices?select=*&limit=0', 'ota_embedded_updates?select=*&limit=0', 'ota_admin_users?select=*&limit=0', 'ota_device_activity_daily?select=*&limit=0'];
      const responses = await Promise.all(selections.map((selection) => fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${selection}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }, redirect: 'error', signal: AbortSignal.timeout(timeout),
      })));
      await Promise.all(responses.map((response) => response.body?.cancel()));
      if (responses.some((response) => !response.ok)) throw new Error('schema');
      add('database.schema', 'pass', 'Core OTA tables are accessible through Supabase REST.');
      add('database.schema-functions', 'warn', 'Supabase REST cannot verify required SQL functions and activation triggers.', 'For full schema diagnostics, run remote mode with DATABASE_PROVIDER=pg and an explicit database connection URL.');
    } catch {
      add('database.schema', 'fail', 'Supabase tables are missing, inaccessible or timed out.', 'Check URL/service-role key, REST permissions and current schema/migrations.');
    }
  } else add('database.connection', 'skip', 'Database probe skipped until configuration is fixed.');
  if (storageConfigured) {
    try {
      if (provider === 'supabase') {
        const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }, redirect: 'error', signal: AbortSignal.timeout(timeout),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error('bucket');
      } else {
        const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ endpoint: env.R2_ENDPOINT, region: env.R2_REGION || 'auto', maxAttempts: 1,
          forcePathStyle: ['true', '1'].includes((env.S3_FORCE_PATH_STYLE || '').toLowerCase()),
          credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
        try { await s3.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(timeout) }); }
        finally { s3.destroy(); }
      }
      add('storage.bucket', 'pass', 'Configured bucket is reachable. Write permissions were not tested.');
    } catch {
      add('storage.bucket', 'fail', 'Bucket is missing, inaccessible or timed out.', 'Check endpoint, region, path-style mode, credentials and bucket existence. No bucket was created.');
    }
  } else add('storage.bucket', 'skip', 'Bucket probe skipped until configuration is fixed.');
  return { checks, keyFingerprint, publicUrl };
}
