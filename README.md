# Beginner Quick Start

This guide takes you from an empty machine to a working OTA server and a
connected Expo application. Deep Docker, PostgreSQL or Supabase knowledge is
not required.

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
cd /path/to/expo-update-custom-server
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

Do not publish `.env` to GitHub.

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

Wait until `postgres`, `minio` and `app` are `healthy`.

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

## Automatic CLI configuration

For an Expo application with a static `app.json`, run this command from the OTA
server repository:

```bash
npm run configure-app
```

The CLI asks for the application path, public certificate, server URL, channel,
runtime, platform and overwrite preference. It displays a summary and requires
confirmation before changing files or running `expo prebuild`.

For CI or advanced usage, pass the same values as flags:

```bash
npm run configure-app -- \
  --app /full/path/to/expo-application \
  --certificate /full/path/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel production \
  --runtime-version 1.0.0
```

The CLI:

1. validates the Expo project;
2. installs the Expo-compatible `expo-updates` version;
3. configures URL, channel, runtime and code signing in `app.json`;
4. copies the public certificate;
5. installs a portable publish script;
6. creates `.env.ota.example`;
7. adds `npm run ota:publish`;
8. installs publisher dependencies;
9. installs Android, Xcode and Xcode Cloud embedded registration hooks;
10. runs `expo prebuild` to synchronize native projects.

Use `--platform ios` or `--platform android` to prebuild one platform. The
default is both platforms.

Existing generated publisher or certificate files are not overwritten. Add
`--force` only when replacement is intentional.

The CLI stops when `app.config.ts`, `app.config.js`, `app.config.mjs` or
`app.config.cjs` exists because dynamic Expo config overrides `app.json`.

After configuration:

```bash
cd /full/path/to/expo-application
cp .env.ota.example .env.ota
```

Fill in the publisher credentials, then run:

```bash
npm run ota:publish -- --message "Describe the change"
```

For local Docker with a `localhost` server URL, the CLI creates the ignored
`.env.ota` automatically from the OTA server `.env`. Manual configuration is
only required for a remote server, Supabase or another storage provider.
Microsoft Dev Tunnel URLs (`*.devtunnels.ms`) are also recognized as local
Docker exposure: the public tunnel is used for `OTA_SERVER_URL`, while the
publisher connects directly to MinIO at `http://127.0.0.1:9000`.

The update is uploaded as inactive. Activate it in the admin panel after
review. The following sections describe the equivalent manual setup.

## Register the update embedded in a binary

Every release binary contains an embedded update. The server needs its ID for
reliable rollback and emergency redirects. The configurator installs this flow
automatically.

For local Docker, build Android with:

```bash
npm run ota:build:android:apk
```

Use `npm run ota:build:android:aab` for an App Bundle. After Gradle succeeds,
the generated script finds `app.manifest` and registers the embedded update.
For iOS, the configurator adds an Xcode Build Phase, so a Release/Archive build
in Xcode performs registration automatically.

For remote CI or Xcode Cloud, do not provide PostgreSQL credentials. Create a
dedicated token:

```bash
docker compose exec app npm run create-access-token
```

Keep the default `updates:write` scope and add the displayed token to CI
secrets:

```env
OTA_SERVER_URL=https://updates.example.com
OTA_ACCESS_TOKEN=ota_...
```

The configurator also creates `ci_scripts/ci_post_xcodebuild.sh`, which Xcode
Cloud runs after a build. The token is shown only once and must never be
committed or included in the mobile binary. Verify registered binaries at
`/updates/embedded`.

## Step 1. Install Expo Updates

```bash
npx expo install expo-updates
```

## Step 2. Copy the public certificate

Copy `code-signing-certificate.pem` into a `certificates` directory in the Expo
application. Never copy the private key into the mobile project.

## Step 3. Configure Expo

Use the `app.config.ts` example in
[`docs/expo-app-setup.md`](docs/expo-app-setup.md). Set:

- `EXPO_OTA_SERVER_URL`;
- `EXPO_UPDATE_CHANNEL`;
- `EXPO_RUNTIME_VERSION`.

A physical device cannot reach the computer through `localhost`. Production
requires a public HTTPS URL.

## Step 4. Build a new native binary

The OTA URL, channel, runtime and certificate are native settings. Build the
iOS or Android application again after changing them.

## Step 5. Publish an update

After automatic configuration, use:

```bash
npm run ota:publish -- --message "Describe the change"
```

The publisher exports JavaScript, uploads assets and inserts database records.
The new update remains inactive until you approve it.

## Step 6. Activate the update

1. Open `/updates` in the admin panel.
2. Find the new update.
3. Confirm its channel, runtime and platform.
4. Activate it manually.

## Step 7. Test on a device

Use a release build, run the update check, download the update and reload the
application. Expo Go is not suitable for this test.

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
  signed S3 requests through a
  generic HTTP tunnel can change the host and
  invalidate the AWS signature.
- `unknown or unexpected option: --platform`: the publisher was generated by
  an older CLI version. Run `npm run configure-app` again and allow generated
  files to be replaced.
- Missing embedded update: confirm that a Release configuration was built and
  CI has `OTA_SERVER_URL` plus an `OTA_ACCESS_TOKEN` with `updates:write`.

Technical reference:

- [`docs/operations-guide.md`](docs/operations-guide.md);
- [`docs/supabase-setup.md`](docs/supabase-setup.md);
- [`docs/expo-app-setup.md`](docs/expo-app-setup.md).

<!-- ## OTA Update Admin Panel

Админ-панель для управления `expo-updates` в PostgreSQL + S3-совместимом bucket (Cloudflare R2).

Аварийное восстановление ошибочного OTA-канала описано в
[`docs/ota-emergency-recovery.md`](docs/ota-emergency-recovery.md).

Установка, Docker, резервное копирование и безопасное обновление описаны в
[`docs/operations-guide.md`](docs/operations-guide.md).

Пошаговая инструкция для начинающих:
[`Русский`](docs/getting-started.ru.md) |
[`English`](docs/getting-started.md).

Быстрый запуск через Supabase SQL Editor описан в
[`docs/supabase-setup.md`](docs/supabase-setup.md).

Настройка Expo-приложения, code signing, получение и публикация OTA описаны в
[`docs/expo-app-setup.md`](docs/expo-app-setup.md).

Автоматическая настройка Expo-приложения со статическим `app.json`:

```bash
npm run configure-app
```

CLI задаст вопросы и покажет итоговые настройки перед изменением приложения.
Для CI также поддерживаются flags:

```bash
npm run configure-app -- \
  --app /path/to/expo-app \
  --certificate /path/to/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel production \
  --runtime-version 1.0.0
```

### Основные возможности

- Логин по сессионной cookie (без регистрации)
- Список апдейтов с сортировкой и пагинацией
- Детальная страница апдейта
- Удаление апдейта из bucket
- Редактирование JSON-файлов (`update-info.json`, `metadata.json`, `channels/*/latest.json`)
- Rollback через перезапись `latest.json`
- Деактивация/активация апдейта

### Переменные окружения

Обязательные:

- `DATABASE_PROVIDER` - провайдер БД: `pg` или `supabase` (по умолчанию `pg`)
- `DATABASE_URL` - строка подключения к PostgreSQL
- `R2_ENDPOINT` - S3 endpoint для Cloudflare R2
- `R2_ACCESS_KEY_ID` - access key для R2
- `R2_SECRET_ACCESS_KEY` - secret key для R2
- `R2_BUCKET` (или `OTA_STORAGE_BUCKET`) - bucket с OTA ассетами

Для `DATABASE_PROVIDER=supabase`:

- `SUPABASE_PROJECT_URL` (или `SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (или `SUPABASE_PUBLISHED_KEY`)

### Пользователи админки

Пользователи, password hashes, роли и активные сессии хранятся в PostgreSQL.
Environment credentials не используются.

Примените единую схему и создайте первого администратора:

```bash
psql "$DATABASE_URL" -f docs/migrations/schema.sql
npm run create-admin
```

Доступны роли:

- `admin` — полный доступ, включая управление access tokens;
- `operator` — управление updates и emergency redirects;
- `viewer` — только просмотр updates и redirects.

Опционально:

- `OTA_PUBLIC_BASE_URL` - публичный URL OTA сервера (для `/api/manifest` и `/api/assets`)
- `OTA_CDN_BASE_URL` - публичный CDN URL для прямой раздачи ассетов (например `https://cdn.cogitize.tech`)
- `OTA_SIGNED_URL_TTL` - TTL signed URL в секундах (по умолчанию `3600`)
- `R2_REGION` - регион для S3 клиента (по умолчанию `auto`)

### Маршруты

- `/login` — страница входа
- `/updates` — список апдейтов
- `/updates/[id]` — страница конкретного апдейта

### Access tokens

Admin API поддерживает cookie-сессию и Bearer tokens. Перед первым
использованием примените миграцию:

```bash
psql "$DATABASE_URL" -f docs/migrations/schema.sql
```

Создание токена доступно только через cookie-сессию администратора:

```http
POST /api/admin/access-tokens
Content-Type: application/json

{
  "name": "Deployment CI",
  "scopes": ["updates:read", "updates:write"],
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

Raw token возвращается только при создании. В базе хранится SHA-256 hash.
Поддерживаемые scopes: `updates:read`, `updates:write`, `redirects:read`,
`redirects:write`.

Использование:

```bash
curl -H "Authorization: Bearer $OTA_ACCESS_TOKEN" \
  https://updates.example.com/api/admin/updates
```

### Emergency redirects

Правила хранятся в таблице `ota_emergency_redirects` и управляются на странице
`/updates/emergency-redirects`.

Перед deploy примените миграцию:

```bash
psql "$DATABASE_URL" -f docs/migrations/schema.sql
```

Если раньше использовался JSON-конфиг, импортируйте его до deploy новой версии:

```bash
npm run emergency:import
```

## Getting Started

Docker Compose:

```bash
cp .env.docker.example .env
mkdir -p secrets
# Copy code-signing-private-key.pem into ./secrets
docker compose up -d --build
docker compose exec app npm run create-admin
```

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details. -->
