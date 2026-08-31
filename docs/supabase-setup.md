# Supabase Setup

Supabase is the simplest hosted PostgreSQL option for the OTA server. It is
not a reduced or development-only installation: the same canonical schema is
used by Supabase, standalone PostgreSQL and Docker Compose.

## 1. Create a project

Create a Supabase project and wait until its database is ready.

Keep these server-side values:

- project URL;
- service role key;
- direct PostgreSQL connection string, if scripts will connect with `pg`.

Never put the service role key or database connection string in an Expo
application.

## 2. Apply the complete schema

Open **SQL Editor** in the Supabase dashboard:

1. Select **New query**.
2. Open
   [`docs/migrations/schema.sql`](https://github.com/tonichiga/expo-update-custom-server/blob/main/docs/migrations/schema.sql)
   from this repository.
3. Copy the complete file into the editor.
4. Select **Run**.

The file is idempotent and is the canonical schema for a new installation. It
creates:

| Table | Purpose |
|---|---|
| `ota_updates` | Published OTA update metadata |
| `ota_update_channels` | Latest and active update pointers |
| `ota_embedded_updates` | Embedded native update metadata |
| `ota_served_manifest_log` | Served manifest to update mapping |
| `ota_device_state` | Last known state of each installation |
| `ota_device_transitions` | Runtime and update transition history |
| `ota_admin_users` | Admin users and roles |
| `ota_admin_sessions` | Revocable browser sessions |
| `ota_access_tokens` | Hashed automation tokens |
| `ota_emergency_redirects` | Emergency channel rules |

Do not run a pgAdmin schema dump as the installation script. Dumps contain
database-specific owners and session commands. `schema.sql` contains only the
portable application schema.

## 3. Configure the server

The recommended Supabase adapter configuration is:

```env
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_UPDATES_BUCKET=expo-updates

OTA_PUBLIC_BASE_URL=https://updates.example.com
CODE_SIGNING_PRIVATE_KEY_PATH=/run/secrets/code-signing-private-key.pem
```

Use the **service role key**, not an anonymous or publishable browser key. The
OTA server is a trusted backend and needs access to all management tables.

Alternatively, use Supabase only as hosted PostgreSQL and object storage while
the server uses the PostgreSQL/S3 adapter:

```env
DATABASE_PROVIDER=pg
DATABASE_URL=postgresql://...
DATABASE_SSL=true

R2_ENDPOINT=https://PROJECT.supabase.co/storage/v1/s3
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=expo-updates
R2_REGION=...
S3_FORCE_PATH_STYLE=true
```

Use the exact S3 endpoint and credentials shown by the Supabase Storage S3
configuration page.

## 4. Create the storage bucket

Create a private bucket named `expo-updates`, or use another name and set the
same value in:

```env
SUPABASE_UPDATES_BUCKET=expo-updates
R2_BUCKET=expo-updates
OTA_STORAGE_BUCKET=expo-updates
```

The bucket must remain private when assets are delivered through signed URLs.

## 5. Create the first administrator

Set the server environment locally, then run:

```bash
npm ci
npm run create-admin
```

The command writes a bcrypt password hash to `ota_admin_users`. It does not
store the plaintext password.

## 6. Verify the installation

Start the server and check:

```bash
curl -fsS https://updates.example.com/api/health
```

Then sign in at:

```text
https://updates.example.com/login
```

The **Table Editor** should show all ten OTA tables listed above.

## 7. Upgrades

Back up the database before upgrades, then apply the current
`docs/migrations/schema.sql`. The schema is idempotent and adds missing
objects. Release notes must explicitly document any future data migration or
destructive change that cannot be represented safely in this file.
