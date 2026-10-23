# Expo Application Setup

This guide connects an Expo application to the self-hosted OTA server for
receiving and publishing updates.

## Automatic configuration

Applications using a static `app.json` can be configured from the OTA server
repository. Install the server dependencies on the host first, including when
the server itself runs in Docker:

```bash
npm ci
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
certificate, installs `expo-updates` and the identity/telemetry dependencies, adds the portable publisher and runs
`expo prebuild`. It supports npm, pnpm, Yarn and Bun lockfiles.

It also generates `ota-client/` and starts identity/installation telemetry from
`ota-entry.js`, preserving the original application entry. For Expo Router,
the configurator renders `<OtaUpdates />` beside navigation in `src/app/_layout`
(or `app/_layout`). The generated TypeScript component owns the hook internally;
it does not wrap the application or require context. Standard `App`
entry components are supported too, including platform variants. No manual
Installation ID, Device ID, or heartbeat wiring is needed. The component starts with automatic checks and manual download/restart prompts;
customized options are preserved on later configurations. See the generated
[OTA client lifecycle](./ota-client-lifecycle.md) for update modes and the hook API.
If generation is unavailable, follow [manual hook integration](./ota-client-lifecycle.md#manual-integration).

The source patch uses syntax-tree locations and keeps existing imports, comments,
directives, component code and nested callbacks. Unsupported root exports
(such as a class, asynchronous function, HOC or re-export) stop configuration
before any application writes. Export a synchronous root function or a local
function identifier to make the patch possible. A custom entry whose root
cannot be identified keeps its existing startup behavior and prints a warning
that update orchestration still needs integration in its root component;
identity and telemetry remain connected through the generated bootstrap.
An existing `useOtaUpdates` import must use a relative path to `ota-client`.
Unresolved aliases such as `@/ota-client` stop the patch before writing, so a
second hook cannot silently override an existing automation configuration.

Options:

```text
--platform all|ios|android
--force
--server-env /full/path/to/server.env
```

The CLI intentionally refuses dynamic `app.config.*` projects and refuses to
replace generated files unless `--force` is provided. The sections below
document native configuration; [manual hook integration](./ota-client-lifecycle.md#manual-integration)
covers client files, dependencies, root wiring and controls. `--force` permits generated
file replacement; it does not bypass unsupported dynamic configs or root shapes.
`--server-env` selects the local server environment used to prepare publisher settings.
For an isolated test stand, explicitly pass its `.env.ota-test`.

## Verify generation in a fresh application

Use a separate app to check first-time generation, and retain an existing app to
check upgrades/reruns. Do not reuse another app's runtime just to make a test OTA
appear: the new app has its own native compatibility boundary.

Create a sibling Expo Router application using the SDK 58 template used for this
client's integration checks:

```bash
npx create-expo-app@latest ota-smoke-app --template default@sdk-58
```

The explicit template pins the SDK family; see the official
[create-expo-app reference](https://docs.expo.dev/more/create-expo/). For another SDK,
use its compatible packages and repeat the release-device checks below.

Prepare a reachable HTTPS OTA server and its matching public signing certificate.
Then run from the **server repository**, adjusting the application/certificate paths:

```bash
npm run configure-app -- \
  --app /full/path/to/ota-smoke-app \
  --certificate /full/path/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel hook-smoke \
  --runtime-version hook-smoke-sdk58-v1 \
  --platform android
```

For the isolated local stand, add `--server-env .env.ota-test` and use the public
tunnel URL for `--server-url`. Configure the same public base on the server so
asset downloads also work from the phone. Use a distinct Android package/iOS bundle
identifier when installing this app alongside an existing test app.

Inspect the resulting diff before building:

| File/change | Expected result |
| --- | --- |
| `app.json` | Correct HTTPS URL, certificate, runtime, channel; native automatic checks disabled |
| `package.json` | Client dependencies, `main: "ota-entry.js"`, publisher and selected platform build scripts |
| `ota-client-entry.json` | Original application entry retained |
| `ota-client/` | Public API, nested model/UI files and public `config.json` |
| Root `_layout` / `App` | One unconditional hook and a gate; existing navigation/providers retained |
| `.env.ota` | Local publisher/build credentials; ignored by Git, never imported by app code |

Before building, add the
[manual controls example](./ota-client-lifecycle.md#_3-add-manual-update-controls)
to a test screen, or explicitly enable download/reload automation through the hook
options. The default root only checks; a stock Expo template has no OTA test buttons.
These controls/options must be in the binary you install so it can receive the first OTA.

From the **application directory**, run:

```bash
npx expo lint
npx tsc --noEmit
npm run ota:build:android:apk
```

The Android command requires a working local Java/Android toolchain. Before running
it, configure embedded registration in `.env.ota`: local Docker can use the generated
`OTA_DATABASE_URL`; HTTP registration requires `OTA_SERVER_URL` and an
`OTA_ACCESS_TOKEN` with `updates:write`. The generated script treats registration
failure as a build failure. See [embedded registration](#_6-register-embedded-updates).
For iOS, configure with `--platform ios`/`all` and build a signed Release/Archive.

Install the release APK from `android/app/build/outputs/apk/release/app-release.apk`.
After its first launch, verify the installation in `/updates/devices`.

Make a visible JS change and update `expo.version` for a distinct chart label,
keeping the compatible runtime unchanged. Publish **after the native build**:

```bash
npm run ota:publish -- --platform android --message "Fresh app hook smoke test"
```

The release appears inactive in `/updates`. Select the intended device audience,
activate it, then check/download/restart. A check or download alone must not move
the installation to the new running version in analytics; the next launch heartbeat
should. Confirm the Installation ID stays unchanged across the OTA restart.

Finally, rerun the same configurator command. Check that it does not duplicate the
OTA component or replace the stored original entry. Change a component prop in the root
and rerun to verify that the option survives. Use `--force` only when intentionally
replacing changed generated files; it does not bypass unsupported root shapes.
For the manual fallback test, use a separate clean copy and follow
[manual integration](./ota-client-lifecycle.md#manual-integration) without running
the generator. Keep these as separate checks so generated leftovers cannot hide
missing manual setup steps.

## 1. Install client dependencies

For manual setup, install Expo-compatible versions of all client dependencies:

```bash
npx expo install expo-updates expo-application expo-crypto expo-secure-store @react-native-async-storage/async-storage
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

The automatic path updates static `app.json`. For manual setup, the dynamic config
below requires an explicit channel and runtime for each build. The current configurator
and stock publisher read static `app.json`; they do not evaluate dynamic config.
Do not use the stock publisher with conflicting static and resolved dynamic values.

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

Within that scope, the server applies activation/rollback rules and the device
audience before selecting an eligible update. Ordinary delivery does not cross
runtime versions, channels or platforms; explicit emergency redirects are a separate
[recovery mechanism](./ota-emergency-recovery.md).

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

Render the generated `<OtaUpdates />` component beside navigation in the root
layout. `configure-app` inserts this integration automatically. If the files or root
patch are missing, follow [manual integration](./ota-client-lifecycle.md#manual-integration),
including the complete Router example and manual controls.

The root defaults to automatic checks and manual download/restart:

```tsx
<OtaUpdates autoCheck autoUpdate={false} autoReload={false} />
```

Optional custom screens can use `useOtaUpdates()` and its `check()`, `download()` and `reload()` methods.
Identity setup, telemetry and update policies share one controller. Do not replace
these actions with direct `Updates.checkForUpdateAsync()`/`fetchUpdateAsync()` calls:
those bypass hook orchestration. Keep native `checkAutomatically: "NEVER"`.
See [the lifecycle reference](./ota-client-lifecycle.md) for force/store/background
behavior, errors and custom guard handlers.

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
app_version
created_at
channel
platform
is_embedded=true
```

Register the value after each iOS and Android release build in
`ota_embedded_updates`. The embedded ID and creation time must come from the
generated Expo embedded manifest, not from a random value created before the
build.

For `app_version`, the registrar keeps a version found in the embedded
manifest as the highest-priority value. Expo SDKs that omit it there fall back
to the trimmed string `expo.version` from the project's static `app.json`.
Missing, blank, malformed or unreadable fallback configuration leaves
`app_version` null without blocking an otherwise valid registration.

The configurator installs the implementation from `templates/expo-app/`:

```text
scripts/ota-register-embedded/register-android.sh
scripts/ota-register-embedded/register-ios.sh
plugins/with-ota-embedded-registration.js
```

If configuring entirely by hand, integrate these registrar scripts with your build
pipeline and configure their server URL/access token; copying the client hook alone
does not register native builds.

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

The configurator installs the portable publisher under `scripts/ota-publish/`
and adds `ota:publish` to the application's `package.json`. It uses static `app.json`
for runtime/channel metadata. Configure the application's ignored `.env.ota` using
`.env.ota.example`; local Docker values can be prepared with `--server-env`.

Run from the **application** directory:

```bash
npm run ota:publish -- --platform android --message "Fix checkout validation"
```

Use `--platform ios` or `--platform all` as needed. This command exports and uploads
the OTA and creates an inactive release in the admin panel; activation is separate.
Do not use EAS Update to publish to this self-hosted server.

Required publisher settings include:

```env
EXPO_UPDATE_CHANNEL=production
OTA_DATABASE_URL=postgresql://...
OTA_DATABASE_SSL=true
R2_ENDPOINT=https://...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=expo-updates
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

- Android APK/AAB build commands that invoke
  `scripts/ota-register-embedded/register-android.sh` after Gradle;
- an iOS Xcode Build Phase that invokes
  `scripts/ota-register-embedded/register-ios.sh` for local Release/Archive
  builds;
- `ci_scripts/ci_post_xcodebuild.sh`, a thin Xcode Cloud adapter that invokes
  the same `register-ios.sh`.

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
