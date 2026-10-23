# Beginner Quick Start

This guide takes you from an empty machine to a working OTA server and a
connected Expo application. Deep Docker, PostgreSQL or Supabase knowledge is
not required.

## Before you start

Use Node.js 24 and npm on the host (also for Docker-based setup), Docker Compose,
and OpenSSL. Building the app also needs the platform's native toolchain: Java/Android
SDK or macOS/Xcode. The server's Docker image does not provide the mobile toolchain.

Create the server files, or use an existing source checkout:

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

NPX only creates files; Docker/Supabase determine where those files run.
Follow the Docker path below for a first test. Run server commands from this folder
until the guide explicitly switches to the application folder.

## What you will have

At the end you can:

1. open the OTA admin panel;
2. sign in as an administrator;
3. connect an Expo application;
4. publish updates;
5. activate an update manually;
6. roll back or configure an emergency redirect.

## Choose one installation path

- **Docker** runs the server, PostgreSQL and MinIO together.
- **Supabase** hosts the database and storage; the OTA server is deployed
  separately.

Use Docker for the quickest local test.

---

# Option A: Docker

## Step 1. Install and start Docker Desktop

Download Docker Desktop from:

```text
https://www.docker.com/products/docker-desktop/
```

Open it and wait until Docker Engine is running.

## Step 2. Open the project folder

In Terminal:

```bash
cd /path/to/expo-updates-server
```

## Step 3. Create the settings file

```bash
cp .env.docker.example .env
```

Open `.env` and replace:

```env
POSTGRES_PASSWORD=choose-a-long-random-password
MINIO_ROOT_PASSWORD=choose-another-long-random-password
```

For this Docker setup, use separate random hexadecimal passwords, for example
values generated with `openssl rand -hex 32`. Compose embeds the database password
in a URL and the configurator copies storage values between env files; special
characters currently need additional handling. Do not publish `.env` to GitHub.

If port `3000` is busy:

```env
OTA_HTTP_PORT=3100
OTA_PUBLIC_BASE_URL=http://localhost:3100
```

If another project already uses PostgreSQL port `5432`, set:

```env
POSTGRES_PORT=5433
```

## Step 4. Create the signing key pair

```bash
mkdir -p secrets local-certificates

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -sha256 \
  -days 3650 \
  -subj "/CN=expo-updates" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -keyout secrets/code-signing-private-key.pem \
  -out local-certificates/code-signing-certificate.pem

chmod 600 secrets/code-signing-private-key.pem
```

Keep `secrets/code-signing-private-key.pem` on the server. Copy
`local-certificates/code-signing-certificate.pem` to the Expo application.
The two files must remain a matching pair.

## Step 5. Start everything

```bash
docker compose up -d --build
docker compose ps
```

The first build compiles a pinned MinIO release from source and may take several
minutes. Go runs inside Docker; no host installation is needed. Subsequent starts
reuse the built image. Bucket creation is automatic; no `minio/mc` image is needed.

Wait until `postgres`, `minio` and `app` are `healthy`. `/api/health` currently
checks the database only. Verify that the app can also read a valid signing key:

```bash
docker compose exec app node -e "require('node:crypto').createPrivateKey(require('node:fs').readFileSync('/run/secrets/ota/code-signing-private-key.pem')); console.log('Signing key OK')"
```

On Linux bind mounts, a host-owned `chmod 600` key can be unreadable to the
container's UID/GID `1001`. If the check reports `EACCES`, grant that group read
access and rerun the check:

```bash
sudo chgrp 1001 secrets/code-signing-private-key.pem
chmod 640 secrets/code-signing-private-key.pem
```

The `secrets` directory must also allow traversal by the container user.

## Step 6. Database setup is automatic

Docker automatically applies:

```text
docs/migrations/schema.sql
```

You do not need pgAdmin or manual SQL commands for a new Docker installation.

## Step 7. Create the first administrator

```bash
docker compose exec app npm run create-admin
```

Enter a username, a password of at least 12 characters and choose `admin`.

## Step 8. Open the admin panel

```text
http://localhost:3000/login
```

Use `3100` if you changed `OTA_HTTP_PORT`.

## Step 9. Local publisher settings

The Expo publisher can reach Docker services through loopback-only ports:

```env
OTA_DATABASE_URL=postgresql://expo_updates:YOUR_POSTGRES_PASSWORD@localhost:YOUR_POSTGRES_PORT/expo_updates
OTA_DATABASE_SSL=false

R2_ENDPOINT=http://localhost:9000
R2_ACCESS_KEY_ID=expo_updates
R2_SECRET_ACCESS_KEY=YOUR_MINIO_ROOT_PASSWORD
R2_BUCKET=expo-updates
```

Use `5432` when `POSTGRES_PORT` was not changed. If `.env` contains
`POSTGRES_PORT=5433`, use `5433` in `OTA_DATABASE_URL` as well.

MinIO Console is available at `http://localhost:9001`.

## Recommended: use an HTTPS tunnel for device testing

Keep `http://localhost` for the admin panel and local publisher connections.
For a physical device, do not use a plain `http://` LAN address. Prefer
temporary HTTPS port forwarding such as
[Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

On macOS:

```bash
brew install --cask devtunnel
devtunnel user login -g
devtunnel host -p 3000 --allow-anonymous
```

If `OTA_HTTP_PORT` is not `3000`, forward that port instead. Copy the generated
`https://...devtunnels.ms` URL into `.env`:

```env
OTA_PUBLIC_BASE_URL=https://YOUR-TUNNEL.devtunnels.ms
```

Apply the changed environment value:

```bash
docker compose up -d --force-recreate app
```

Pass the same HTTPS URL to `npm run configure-app` as the server URL. The
configurator recognizes `*.devtunnels.ms` as local Docker exposure and keeps
the publisher connected directly to MinIO at
`R2_ENDPOINT=http://127.0.0.1:9000`.

Do not forward PostgreSQL or MinIO to the internet. Signed S3 requests should
not pass through a generic HTTP tunnel because host rewriting can invalidate
the signature.

`--allow-anonymous` lets the Expo application reach the OTA endpoint without
an interactive Dev Tunnels login, but it also makes the forwarded port
publicly reachable. Use a temporary tunnel, strong admin credentials, and stop
the tunnel immediately after testing.

---

# Option B: Supabase

Supabase replaces PostgreSQL and MinIO. It does not run the OTA web server.

## Step 1. Create a project

1. Open `https://supabase.com`.
2. Select **New project**.
3. Enter a project name.
4. Create and save a strong database password.
5. Select a nearby region.
6. Wait until the project is ready.

## Step 2. Install the schema

1. Open **SQL Editor** in the left sidebar.
2. Select **New query**.
3. Open `docs/migrations/schema.sql` on your computer.
4. Copy the entire file.
5. Paste it into Supabase SQL Editor.
6. Select **Run**.
7. Wait for the success message.

No other migration files are required.

## Step 3. Confirm the tables

Open **Table Editor**. You should see:

```text
ota_access_tokens
ota_admin_sessions
ota_admin_users
ota_device_state
ota_device_transitions
ota_embedded_updates
ota_emergency_redirects
ota_guard_actions
ota_served_manifest_log
ota_update_channels
ota_updates
```

## Step 4. Create storage

1. Open **Storage**.
2. Select **New bucket**.
3. Name it `expo-updates`.
4. Keep the bucket private.
5. Select **Create bucket**.

## Step 5. Get server credentials

Find the project URL and `service_role` key in project settings. The service
role key is a backend secret. Never place it in the Expo application.

## Step 6. Configure the OTA server

Create a matching [signing key pair](#step-4-create-the-signing-key-pair) first.
Set the private-key path below to the actual server-readable file; retain the
public certificate for application configuration.

Create `.env.local`:

```env
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_UPDATES_BUCKET=expo-updates

OTA_PUBLIC_BASE_URL=https://updates.example.com
CODE_SIGNING_PRIVATE_KEY_PATH=/full/path/code-signing-private-key.pem
```

## Step 7. Start and check the server

```bash
npm ci
npm run build
npm run start
```

Open `http://localhost:3000/api/health`. A response containing
`"status":"ok"` means the database connection works.

## Step 8. Create the administrator

```bash
npm run create-admin
```

Choose the `admin` role for the first user.

---

# Connect the Expo application

These steps are the same for Docker and Supabase.

## 1. Configure the application

Prerequisites: Node.js/npm on the host, a static `app.json` Expo project, the
public signing certificate, and the HTTPS server URL reachable from the phone.
Use the same URL for the server's `OTA_PUBLIC_BASE_URL`. The configurator runs
on the host even when the server runs in Docker.

From the **server directory**:

```bash
npm ci
npm run configure-app
```

Select the app directory, certificate, public URL, channel, runtime and platform.
The CLI installs dependencies, configures native updates, generates the identity
and telemetry client, inserts the root hook/gate, installs publisher/registration
scripts and runs prebuild. Review its summary before applying changes.

For flags, supported root components and reruns, see
[automatic configuration](./expo-app-setup.md#automatic-configuration).
Dynamic `app.config.*` projects require [manual client integration](./ota-client-lifecycle.md#manual-integration);
the bundled publisher currently reads static `app.json` only.

## 2. Check publisher and build credentials

Switch to the **application directory**. For local Docker exposed through
localhost or `*.devtunnels.ms`, the configurator can create `.env.ota` from the
server's `.env`. Keep that generated file. If it does not exist, create it once:

```bash
cd /full/path/to/expo-application
[ -f .env.ota ] || cp .env.ota.example .env.ota
```

Fill any missing database and storage credentials from your server setup. Keep
this file ignored by Git and out of application imports. The publisher needs
`OTA_DATABASE_URL` and S3 credentials; an admin access token does not replace them.

Embedded-build registration can use the same local `OTA_DATABASE_URL`. For
registration over HTTP, provide `OTA_SERVER_URL` and an `OTA_ACCESS_TOKEN` with
`updates:write`; create it with `docker compose exec app npm run create-access-token`
from the **server directory** for Docker, or `npm run create-access-token` for
a server running directly with npm. See [embedded registration](./expo-app-setup.md#_6-register-embedded-updates).

## 3. Build and install a native release

Before building, choose how the app will download and apply updates.

The generated root checks automatically, but defaults to manual download/restart.
Add the [manual controls example](./ota-client-lifecycle.md#_3-add-manual-update-controls)
to a test screen, or explicitly configure automation using the [hook options](./ota-client-lifecycle.md).
The generator does not add test buttons to your application's UI.

From the **application directory**, with the Android toolchain installed:

```bash
npm run ota:build:android:apk
```

Install `android/app/build/outputs/apk/release/app-release.apk` on the phone.
For iOS, build a signed Release/Archive in Xcode; the generated build phase
registers the embedded update. Registration must succeed before continuing.

URL, runtime, channel, certificate and added native modules require a new native
build. Expo Go and development mode do not test this lifecycle. Launch the release
and confirm it appears under `/updates/devices`; confirm its embedded update under
`/updates/embedded`.

## 4. Publish the first OTA

Make a visible JavaScript change **after building the binary**. Keep its compatible
runtime and channel; change `expo.version` if you want a distinct version label.
From the **application directory**:

```bash
npm run ota:publish -- --platform android --message "First OTA smoke test"
```

Use `--platform ios` for iOS. The command exports and uploads the update as inactive.
In `/updates`, verify platform/runtime/channel, select the intended device audience,
then activate the update.

## 5. Download, restart and verify

Check → download → restart. Confirm the visible change and the new running version
under `/updates/devices`. Download alone must not change the reported running version.
The Installation ID should stay unchanged across an OTA restart.

For a separate first-install test and idempotent configurator reruns, use
[fresh app verification](./expo-app-setup.md#verify-generation-in-a-fresh-application).

## Diagnose the setup

From the **server directory**, run `npm run doctor -- --app /full/path/to/expo-application`.
This checks the running Docker stack and app source without changing them.
For npm/remote deployments add `--mode remote --server-env .env.local`.
Use `--offline` before starting services. See [doctor](./doctor.md) for custom
Compose projects, JSON output and the checks that still require a real device.

## Troubleshooting

- Server failure: `docker compose logs app`.
- Container state: `docker compose ps`.
- Port conflict: change the matching `*_PORT` in `.env`.
- `password authentication failed for user "expo_updates"` after editing
  `.env`: the existing PostgreSQL volume still has its original password. Run:

  ```bash
  npm run docker:sync-db-password
  docker compose restart app
  ```

- Missing Supabase tables: run the complete `schema.sql` again.
- Missing update: compare platform, runtime and channel.
- Signature error: the server private key does not match the app certificate.
- `SignatureDoesNotMatch`: `.env.ota` storage credentials do not match MinIO
  or R2. For local Docker, run `npm run configure-app` again and allow generated
  files to be replaced so `.env.ota` is synchronized from the server `.env`.
  If the OTA server uses a Dev Tunnel, put the tunnel URL in `OTA_SERVER_URL`
  but keep `R2_ENDPOINT=http://127.0.0.1:9000` for a local publisher. Sending
  signed S3 requests through a generic HTTP tunnel can change the host and
  invalidate the AWS signature.
- `unknown or unexpected option: --platform`: the publisher was generated by
  an older CLI version. Run `npm run configure-app` again and allow generated
  files to be replaced.
- Missing embedded update: confirm that a Release configuration was built and
  CI has `OTA_SERVER_URL` plus an `OTA_ACCESS_TOKEN` with `updates:write`.

Technical reference:

- [Operations guide](https://github.com/tonichiga/expo-updates-server/blob/main/docs/operations-guide.md);
- [Supabase setup](https://github.com/tonichiga/expo-updates-server/blob/main/docs/supabase-setup.md);
- [Expo application setup](https://github.com/tonichiga/expo-updates-server/blob/main/docs/expo-app-setup.md).
