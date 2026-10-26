# OTA emergency recovery {#аварииное-восстановление-ota}

## Global emergency stop {#глобальная-аварииная-остановка}

To immediately stop **all** OTA distribution, use the global `ACTIVE/BLOCKED` switch on `/updates`. It takes priority over every emergency redirect: manifests return `noUpdateAvailable`, and previously issued `/api/assets` links stop serving bytes and return `503 no-store`.

Enter a reason or incident number, confirm the stop, and check the manifest and asset URLs. After fixing the issue, check channel pointers, confirm that distribution can resume, and repeat the checks for iOS and Android.

The switch RPC and database mutation triggers share a transaction advisory lock. A concurrent activation or channel mutation therefore either completes before `BLOCKED` is enabled, or waits and is rejected by PostgreSQL with SQLSTATE `P0OTA` and message `OTA_DISTRIBUTION_BLOCKED`. Deactivation, inactive draft insertion and safe metadata edits remain available. Do not disable guard triggers during an incident.

New manifests use gated server-proxy URLs at `/api/assets`. The switch cannot revoke immutable storage/CDN URLs issued by older server versions; account for this legacy URL limitation in incident response.

An emergency redirect is needed when a published native binary requests the wrong Expo channel. JavaScript OTA cannot change the channel recorded in Android Manifest or iOS Expo.plist, so the server redirects only the affected build.

The rule applies only when all of these match exactly:

- `expo-embedded-update-id`;
- runtime version;
- platform;
- source channel.

Never redirect an entire runtime: development and production builds can share the same runtime version.

## Prepare the database {#подготовка-бд}

```bash
psql "$DATABASE_URL" -f docs/migrations/schema.sql
```

If rules were previously stored in `config/ota-emergency-channel-redirects.json`, import them before deployment:

```bash
npm run emergency:import
```

After a successful import, the server no longer uses the JSON file.

## Management {#управление}

Open:

```text
/updates/emergency-redirects
```

The `admin` and `operator` roles can:

- create and edit rules;
- enable and disable redirects;
- switch between `pinned` and `follow`;
- delete rules.

The `viewer` role has read-only access.

## Modes {#режимы}

### Pinned {#pinned}

The server permits only `expectedUpdateId`. If the target channel points to another update, the device receives `noUpdateAvailable`.

Use `pinned` during initial recovery so the affected build receives only the verified recovery OTA.

### Follow {#follow}

The server uses the current active/latest update of the target channel. After the recovery OTA is successfully installed, switch the rule to `follow` so the old binary continues receiving regular updates.

## Example incident {#пример-инцидента}

An Android build may be published with:

```text
runtime: 1.1.20
native channel: development
expected environment: production
```

The application screen may still show `production` if it reads JavaScript configuration. Expo Updates will nevertheless send:

```text
expo-channel-name: development
```

Create a rule for the affected embedded update:

```text
platform: android
runtimeVersion: 1.1.20
fromChannel: development
toChannel: production
targetMode: pinned
expectedUpdateId: <verified-recovery-update-id>
```

After confirming recovery, switch the rule to `follow`.

## Verification {#проверка}

```bash
curl -fsS \
  'https://updates.example.com/api/manifest' \
  -H 'expo-protocol-version: 1' \
  -H 'expo-platform: android' \
  -H 'expo-runtime-version: 1.1.20' \
  -H 'expo-channel-name: development' \
  -H 'expo-embedded-update-id: <affected-embedded-update-id>'
```

Check that the multipart manifest contains the expected update and the target channel's asset URLs.
