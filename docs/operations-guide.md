# Operations Guide

This guide describes installation, day-to-day administration, incident
recovery, backups and upgrades for the OTA update server.

## 1. Required infrastructure

- Node.js 24 and npm, or Docker with Docker Compose;
- PostgreSQL 15 or newer;
- S3-compatible object storage such as Cloudflare R2 or MinIO;
- HTTPS public URL for production;
- optional CDN in front of the whole OTA server (it must respect
  `Cache-Control: no-store` on blocked asset responses).

## 2. Environment

Copy `.env.example` to `.env.local` for a manual installation.

Required for PostgreSQL and S3:

```env
DATABASE_PROVIDER=pg
DATABASE_URL=postgresql://user:password@host:5432/database
DATABASE_SSL=true

R2_ENDPOINT=https://storage.example.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=expo-updates
R2_REGION=auto

OTA_PUBLIC_BASE_URL=https://updates.example.com
```

For MinIO, also set:

```env
S3_FORCE_PATH_STYLE=true
```

Never commit `.env.local`, database passwords, storage keys, access tokens or
code-signing private keys.

## 3. Database installation

For PostgreSQL or Supabase, apply the single canonical schema:

```bash
psql "$DATABASE_URL" -f docs/migrations/schema.sql
```

Supabase SQL Editor installation is described in
[`supabase-setup.md`](supabase-setup.md).

The schema uses idempotent object creation and can also fill missing objects in
an existing installation. Back up the database before applying it.

## 4. First administrator

Create or reset a user interactively:

```bash
npm run create-admin
```

Roles:

| Role | Permissions |
|---|---|
| `admin` | Full access and access-token management |
| `operator` | Manage updates and emergency redirects |
| `viewer` | Read-only access |

Passwords must contain at least 12 characters. Only bcrypt hashes are stored.

## 5. Manual startup

```bash
npm ci
npm run build
npm run start
```

Readiness:

```bash
curl -fsS http://localhost:3000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "checks": {
    "database": "ok"
  }
}
```

## 6. Docker Compose quick start

```bash
cp .env.docker.example .env
```

Replace both passwords in `.env`. Generate or copy the code-signing private
key before starting:

```bash
mkdir -p secrets
cp /secure/path/code-signing-private-key.pem \
  secrets/code-signing-private-key.pem
chmod 600 secrets/code-signing-private-key.pem
```

Then start the stack:

```bash
docker compose up -d --build
docker compose ps
```

If port `3000` is already used, update both values in `.env`:

```env
OTA_HTTP_PORT=3100
OTA_PUBLIC_BASE_URL=http://localhost:3100
```

Services:

- admin and OTA server: `http://localhost:3000`;
- MinIO console: `http://localhost:9001`;
- PostgreSQL and MinIO API are available only inside the Compose network.

The private key is mounted read-only at
`/run/secrets/ota/code-signing-private-key.pem`. The public certificate belongs
in each Expo application, never in the server container.

On a fresh PostgreSQL volume, `docs/migrations/schema.sql` is applied
automatically. Create the first administrator inside the application
container:

```bash
docker compose exec app npm run create-admin
```

Stop without deleting data:

```bash
docker compose down
```

Delete the local database and object storage only when a full reset is
intended:

```bash
docker compose down --volumes
```

Changing `POSTGRES_PASSWORD` in `.env` does not update the role password inside
an existing PostgreSQL volume. Synchronize it without deleting data:

```bash
npm run docker:sync-db-password
docker compose restart app
```

## 7. Access tokens

Access tokens are intended for CI, scripts and a future publish CLI. They are
not sent by mobile devices.

Create them through `POST /api/admin/access-tokens` while authenticated as an
`admin`. Store the returned raw token immediately; it is shown only once.

Example:

```bash
curl \
  -H "Authorization: Bearer $OTA_ACCESS_TOKEN" \
  https://updates.example.com/api/admin/updates
```

Available scopes:

- `updates:read`;
- `updates:write`;
- `redirects:read`;
- `redirects:write`.

Revoke unused or exposed tokens immediately.

## 8. Updates and rollback

The update list is available at `/updates`.

- **Deactivate** stops serving an update.
- **Rollback** pins the channel to an older active update.
- **Promote** ends rollback mode and resumes serving the latest update.
- Do not manually edit channel pointers directly in PostgreSQL during normal
  operation.

After rollback, verify both platforms and the exact runtime/channel scope.

## 9. Emergency redirects

Rules are managed at `/updates/emergency-redirects`.

Use `pinned` first:

1. Match the exact embedded update ID, runtime, platform and source channel.
2. Set the correct target channel.
3. Pin a verified recovery update ID.
4. Confirm the affected build receives and launches the recovery OTA.
5. Switch to `follow` so the old binary receives future target-channel
   updates.

If migrating from the legacy JSON configuration:

```bash
npm run emergency:import
```

The manifest runtime reads only `ota_emergency_redirects` after migration.

## 9.1 Global OTA emergency switch

The prominent control at `/updates` is the highest-priority incident switch.
When it is **BLOCKED**:

- every manifest request receives Expo's signed `noUpdateAvailable`
  directive;
- every `/api/assets` request fails closed with `503` and
  `Cache-Control: no-store`;
- activation, rollback, promote, and distributing `channel-latest.json` /
  `update-meta.json` mutations return `409`;
- update activation and channel distribution changes are also rejected in
  PostgreSQL with SQLSTATE `P0OTA` and an `OTA_DISTRIBUTION_BLOCKED` message,
  including ordinary direct SQL writes;
- deactivation, inactive draft inserts, safe metadata edits, and channel
  pointer cleanup that leaves no served update remain available. Deleting an
  update remains available only when foreign-key pointer cleanup would not
  promote or redirect another update.

Enabling the switch requires a reason and confirmation. Disabling it also
requires confirmation. Viewers can inspect the status but cannot change it.
State changes use an optimistic version and are audited with actor and time.
The switch RPC and distribution triggers share a transaction-scoped database
lock, so a concurrent mutation either completes before BLOCKED takes effect or
waits and is rejected; there is no check/mutation window. Do not disable these
triggers during an incident.

Incident procedure:

1. Open `/updates`, enter the incident/ticket and impact as the reason, then
   choose **Stop all OTA**.
2. Confirm both a manifest check (`noUpdateAvailable`) and a previously issued
   `/api/assets` URL (`503`, no-store).
3. Investigate or deactivate the bad updates while distribution stays blocked.
4. Before resuming, verify channel pointers and both platforms.
5. Choose **Resume OTA**, confirm, then repeat manifest checks.

The switch requires migration
`docs/migrations/2026-09-02-ota-distribution-control.sql`. A missing table or
database read failure is deliberately not interpreted as ACTIVE: manifests
and assets fail closed.

`OTA_CDN_BASE_URL` is retained only as a deprecated configuration value. New
manifests always use the server's gated `/api/assets` URLs. If an external CDN
is used, place it in front of the OTA server rather than exposing the storage
bucket URL, and make sure it honors the asset endpoint's `private, no-store`
response. The switch cannot revoke immutable legacy storage/CDN URLs that were
already issued by an older server version; purge or disable that legacy CDN
before relying on the switch for those manifests.

## 10. Backups

PostgreSQL:

```bash
pg_dump --format=custom "$DATABASE_URL" > ota-database.dump
```

Restore into an empty database:

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" ota-database.dump
```

Object storage must be backed up separately using the provider's replication,
versioning or S3 synchronization tools. A database backup without assets is
not sufficient to restore OTA delivery.

For Docker volumes:

```bash
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  > ota-database.dump
```

## 11. Safe upgrade order

1. Back up PostgreSQL and object storage.
2. Read the new migration files.
3. Apply backward-compatible migrations.
4. Run tests and build the new image.
5. Deploy the application.
6. Check `/api/health`.
7. Verify manifest requests for production iOS and Android scopes.
8. Keep the previous image available for application rollback.

Never deploy code that reads a new table before creating that table.

## 12. Expo application integration

Client configuration, code-signing certificates, embedded update registration,
manual update checks and the current publish workflow are described in
[`expo-app-setup.md`](expo-app-setup.md).
