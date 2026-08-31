# Expo Application Setup

This guide connects an Expo application to the self-hosted OTA server for
receiving and publishing updates.

## Automatic configuration

Applications using a static `app.json` can be configured from the OTA server
repository:

```bash
npm run configure-app
```

The interactive CLI asks for each required value and confirms the final plan
before changing the application.

For non-interactive CI usage:

```bash
npm run configure-app -- \
  --app /full/path/to/expo-app \
  --certificate /full/path/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel production \
  --runtime-version 1.0.0
```

The command patches `app.json` and `package.json`, copies the public
certificate, installs `expo-updates`, adds the portable publisher and runs
`expo prebuild`. It supports npm, pnpm, Yarn and Bun lockfiles.

Options:

```text
--platform all|ios|android
--force
```

The CLI intentionally refuses dynamic `app.config.*` projects and refuses to
replace generated files unless `--force` is provided. The sections below
document the equivalent manual configuration.

## 1. Install Expo Updates

Install the Expo-compatible version of `expo-updates`:

```bash
npx expo install expo-updates
```

The application does not send an admin access token when checking for an
update. `/api/manifest` and `/api/assets` are public runtime endpoints. Admin
sessions and access tokens are only for operators, CI and administrative
automation.

## 2. Create the code-signing certificate

Create one RSA private key and a self-signed public certificate:

```bash
mkdir -p certificates

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
  -keyout certificates/code-signing-private-key.pem \
  -out certificates/code-signing-certificate.pem
```

The two files have different owners and deployment rules:

| File | Location | May be committed |
|---|---|---|
| `code-signing-certificate.pem` | Expo application | Yes, it is public |
| `code-signing-private-key.pem` | OTA server only | No |

For Docker Compose, copy only the private key to the server repository:

```bash
mkdir -p secrets
cp /secure/path/code-signing-private-key.pem \
  secrets/code-signing-private-key.pem
chmod 600 secrets/code-signing-private-key.pem
```

The Compose stack mounts `./secrets` read-only and reads the key from
`/run/secrets/ota/code-signing-private-key.pem`.

For a non-container deployment, configure either:

```env
CODE_SIGNING_PRIVATE_KEY_PATH=/run/secrets/code-signing-private-key.pem
```

or an inline PEM:

```env
CODE_SIGNING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Never rotate the server private key without shipping a new binary containing
the matching public certificate. Existing binaries reject manifests signed by
an unknown key.

## 3. Configure the Expo application

Use a dynamic Expo config so the channel cannot accidentally remain
`development` in a production binary.

Example `app.config.ts`:

```ts
import type { ConfigContext, ExpoConfig } from "expo/config";

const CHANNELS = ["development", "preview", "production"] as const;
type UpdateChannel = (typeof CHANNELS)[number];

function getUpdateChannel(): UpdateChannel {
  const value = process.env.EXPO_UPDATE_CHANNEL?.trim().toLowerCase();

  if (!CHANNELS.includes(value as UpdateChannel)) {
    throw new Error(
      `EXPO_UPDATE_CHANNEL must be one of: ${CHANNELS.join(", ")}`,
    );
  }

  return value as UpdateChannel;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const channel = getUpdateChannel();
  const runtimeVersion = process.env.EXPO_RUNTIME_VERSION?.trim();
  const otaServerUrl = process.env.EXPO_OTA_SERVER_URL?.trim();

  if (!runtimeVersion) {
    throw new Error("EXPO_RUNTIME_VERSION is required");
  }

  if (!otaServerUrl) {
    throw new Error("EXPO_OTA_SERVER_URL is required");
  }

  return {
    ...config,
    name: config.name ?? "My App",
    slug: config.slug ?? "my-app",
    runtimeVersion,
    updates: {
      enabled: true,
      url: `${otaServerUrl.replace(/\/$/, "")}/api/manifest`,
      checkAutomatically: "NEVER",
      fallbackToCacheTimeout: 0,
      codeSigningCertificate:
        "./certificates/code-signing-certificate.pem",
      codeSigningMetadata: {
        alg: "rsa-v1_5-sha256",
        keyid: "main",
      },
      requestHeaders: {
        "expo-channel-name": channel,
      },
    },
    extra: {
      ...config.extra,
      updateChannel: channel,
    },
  };
};
```

The server currently signs with `keyid="main"`, so the application's
`codeSigningMetadata.keyid` must also be `main`.

### How updates are isolated

Each native binary requests an update using three selection keys:

```text
runtimeVersion + channel + platform
```

The server looks up only the latest active update inside that exact scope.
Updates do not cross runtime versions, channels, or platforms.

```mermaid
flowchart TD
  Client[Native binary] --> Headers["runtimeVersion=1.1<br/>channel=production<br/>platform=ios"]
  Headers --> Match["Exact scope:<br/>1.1 / production / ios"]
  Match --> Active[Latest active update]

  Runtime10["1.0 / production / ios"] -. different runtime .-> Rejected[Not eligible]
  Development["1.1 / development / ios"] -. different channel .-> Rejected
  Android["1.1 / production / android"] -. different platform .-> Rejected
```

Example release history:

| Event | Result |
|---|---|
| App `1.0.0` is built with runtime `1.0` and channel `production` | It receives only active `1.0 / production` updates for its platform |
| App `1.1.0` is built with runtime `1.1` and channel `production` | It cannot receive an update published for runtime `1.0` |
| A runtime `1.1` update is published to `development` | Production builds do not receive it |
| The same update is approved and published to `production` | Runtime `1.1` production builds become eligible |

Introducing runtime `1.1` does not delete or globally disable runtime `1.0`.
Older binaries still report runtime `1.0` and may continue receiving its
active updates. If support for those binaries must end, deactivate the
corresponding runtime `1.0` updates explicitly.

Do not confuse the store-facing application version with Expo
`runtimeVersion`. The server uses `runtimeVersion` for compatibility. A
runtime change requires a new native binary because an OTA update cannot
change its own runtime, channel, or signing certificate.

### Local device testing through HTTPS

A physical device cannot reach the computer through `localhost`. Do not use a
plain HTTP LAN address for OTA testing. Prefer temporary HTTPS port forwarding
such as
[Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

For a Docker installation, forward only the application port:

```bash
devtunnel user login -g
devtunnel host -p 3000 --allow-anonymous
```

Set the generated `https://...devtunnels.ms` URL as both
`OTA_PUBLIC_BASE_URL` on the server and `EXPO_OTA_SERVER_URL` in the
application. Recreate the server container after changing `.env`:

```bash
docker compose up -d --force-recreate app
```

Keep database and storage connections local. In particular, retain
`R2_ENDPOINT=http://127.0.0.1:9000` for the local publisher instead of routing
signed S3 requests through the tunnel.

Anonymous tunnel access is necessary when the mobile application cannot
complete the Dev Tunnels login flow. It also exposes the forwarded application
port publicly, so use a temporary tunnel, strong admin credentials, and stop
it after testing.

Example EAS profiles:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_UPDATE_CHANNEL": "development",
        "EXPO_RUNTIME_VERSION": "1.0.0",
        "EXPO_OTA_SERVER_URL": "https://updates.example.com"
      }
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_UPDATE_CHANNEL": "preview",
        "EXPO_RUNTIME_VERSION": "1.0.0",
        "EXPO_OTA_SERVER_URL": "https://updates.example.com"
      }
    },
    "production": {
      "env": {
        "EXPO_UPDATE_CHANNEL": "production",
        "EXPO_RUNTIME_VERSION": "1.0.0",
        "EXPO_OTA_SERVER_URL": "https://updates.example.com"
      }
    }
  }
}
```

`runtimeVersion` and channel are native configuration. They cannot be changed
by an OTA update. A native rebuild is required whenever either value or the
certificate changes.

## 4. Generate and verify native configuration

Generate native projects or synchronize existing ones:

```bash
EXPO_UPDATE_CHANNEL=production \
EXPO_RUNTIME_VERSION=1.0.0 \
EXPO_OTA_SERVER_URL=https://updates.example.com \
npx expo prebuild
```

Verify the resolved Expo config before building:

```bash
EXPO_UPDATE_CHANNEL=production \
EXPO_RUNTIME_VERSION=1.0.0 \
EXPO_OTA_SERVER_URL=https://updates.example.com \
npx expo config --type public
```

For projects that commit `ios/` and `android/`, also inspect the generated
native values:

- iOS `Expo.plist`:
  - `EXUpdatesURL`;
  - `EXUpdatesRuntimeVersion`;
  - `EXUpdatesRequestHeaders`;
  - `EXUpdatesCodeSigningCertificate`.
- Android manifest/resources:
  - `expo.modules.updates.EXPO_UPDATE_URL`;
  - `expo.modules.updates.EXPO_RUNTIME_VERSION`;
  - `expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`;
  - `expo.modules.updates.CODE_SIGNING_CERTIFICATE`.

Do not rely only on `eas.json`. The final native binary must contain the
expected URL, runtime, channel and certificate.

## 5. Check and install updates in the application

With `checkAutomatically: "NEVER"`, the application controls the user
experience:

```ts
import * as Updates from "expo-updates";

export async function checkForOtaUpdate() {
  if (__DEV__) {
    return { available: false };
  }

  const result = await Updates.checkForUpdateAsync();
  return { available: result.isAvailable };
}

export async function installOtaUpdate() {
  const result = await Updates.fetchUpdateAsync();

  if (!result.isNew) {
    return;
  }

  await Updates.reloadAsync();
}
```

Expo Updates automatically sends the runtime headers used by the server,
including:

- `expo-platform`;
- `expo-runtime-version`;
- `expo-current-update-id`;
- `expo-embedded-update-id`;
- the configured `expo-channel-name`.

These headers allow normal selection, rollback protection and exact emergency
redirect matching without custom device authentication.

## 6. Register embedded updates

Emergency redirects and downgrade protection work best when every released
native binary registers its embedded update:

```text
embedded_update_id
created_at
channel
platform
is_embedded=true
```

Register the value after each iOS and Android release build in
`ota_embedded_updates`. The embedded ID and creation time must come from the
generated Expo embedded manifest, not from a random value created before the
build.

The MIEX application contains a reference implementation:

```text
scripts/build-update/register-embedded-update.mjs
android/ci_scripts/register_embedded_update_android.sh
```

Registration should be a required CI step for production builds. If it fails,
the binary should not be distributed.

## 7. Publish an OTA update

This repository currently serves and manages updates; it does not yet expose
an HTTP upload endpoint. The publisher therefore runs from the Expo
application repository and needs PostgreSQL plus S3-compatible storage
credentials.

A publisher performs these steps:

1. Resolve the exact channel and runtime used by the target native binary.
2. Run `npx expo export --platform ios` and/or `--platform android`.
3. Read Expo `metadata.json`.
4. Calculate hashes and content types for the launch asset and all assets.
5. Upload immutable files to the configured bucket.
6. Insert the update into `ota_updates`.
7. Update `ota_update_channels.latest_update_id`.
8. Leave the update inactive when manual activation is required.
9. Activate or roll back from the admin panel after validation.

The MIEX application already implements this workflow under:

```text
scripts/build-update/
```

Its relevant environment is:

```env
EXPO_UPDATE_CHANNEL=production
OTA_DATABASE_URL=postgresql://...
OTA_DATABASE_SSL=true
OTA_SYNC_UPDATES_DB=true

R2_ENDPOINT=https://...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=expo-updates
```

Example publish command in that application:

```bash
npm run local-update:production -- -m "Fix checkout validation"
```

The application's configured channel, exported runtime, uploaded storage path
and database records must all use the same values. Publishing JavaScript for a
different `runtimeVersion` is safe but the binary will not select it.

Direct database and storage credentials are acceptable for a trusted local
publisher. Do not distribute them in the mobile binary. Embedded build
registration can use the authenticated endpoint:

```text
POST /api/admin/embedded-updates
Authorization: Bearer ota_...
```

Create a dedicated access token with `npm run create-access-token` (or
`docker compose exec app npm run create-access-token`) and keep only
`updates:write`. Set `OTA_SERVER_URL` and `OTA_ACCESS_TOKEN` as CI secrets.

The app configurator installs:

- Android APK/AAB build commands that register `app.manifest` after Gradle;
- an iOS Xcode Build Phase for local Release/Archive builds;
- `ci_scripts/ci_post_xcodebuild.sh` for Xcode Cloud.

Registered binaries are visible at `/updates/embedded`.

## 8. End-to-end verification

Check server readiness:

```bash
curl -fsS https://updates.example.com/api/health
```

Check a signed manifest response:

```bash
curl -i \
  -H "expo-protocol-version: 1" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H 'expo-expect-signature: sig, keyid="main"' \
  https://updates.example.com/api/manifest
```

The response must be `200`, use `multipart/mixed`, and include an
`expo-signature` part for the manifest or directive.

Final device test:

1. Install a release binary, not Expo Go.
2. Confirm its runtime and native channel in application diagnostics.
3. Publish an OTA for the same platform/runtime/channel.
4. Activate it in `/updates`.
5. Run the application's update check.
6. Download, reload and confirm the new update ID.
7. Test rollback and an exact emergency redirect before production launch.
