# Generated OTA client lifecycle

`configure-app` generates a formatted TypeScript client and renders `<OtaUpdates />`
beside navigation in the root layout/App. The component calls `useOtaUpdates`
internally; it does not wrap the app or provide React context. Mount it once in a
persistent root, including loading/early-return paths.

By default it checks automatically and shows **Download / Later** for an ordinary
update, then **Restart / Later** when downloaded. `autoUpdate={false}` disables
automatic downloading, not the prompt. A dismissed candidate stays hidden until the
component remounts, a different candidate arrives, or its download state changes.
Background updates remain silent; required updates cannot be dismissed.

The lower-level `useOtaUpdates()` is still available for optional custom screens.
It shares state/actions but defaults to no automation and renders no UI. Configure
automation in one root; multiple configured consumers combine booleans with OR.
Keep custom guard handlers stable.

Identity is persisted and installed in Expo request parameters before any check/download.
Launch/foreground heartbeats report only the **running** bundle, never a downloaded
candidate. Network telemetry does not block app launch or update checks. Development,
Expo Go, web and disabled-updates builds leave automation off.

| Policy/options | Behavior |
| --- | --- |
| manual, default options | OtaUpdates offers download/restart; the hook alone exposes state |
| autoCheck | Check on mount and foreground, minimum interval 60 seconds |
| autoUpdate | Also download eligible manual candidates |
| autoReload | Reload a pending non-background bundle while app is active |
| delivery=background | Download silently; apply on next cold launch or manual reload |
| guard=ota-force-update | Block with gate, download automatically; restart button when ready |
| guard=ota-force-store-update | Block with gate; open store, never download this candidate |
| custom/unknown guard | Block until guardHandlers[action] explicitly returns `allow` |

Store guard payload: `{ "androidUrl": "market://details?id=com.example.app",
"iosUrl": "https://apps.apple.com/app/id123" }`; `url` is a common fallback. Only
https, market and itms-apps URLs are accepted. Native upgrades still require a store
release; OTA cannot add native modules or change the installed runtime.

The built-in gate is a non-dismissable modal that preserves mounted navigation and providers.
Customize required UI with `renderBlocked`, and optional UI with `renderAvailable`.
Keep `OtaUpdates` mounted beside navigation; a hook alone exposes `blocked` but cannot prevent interaction with
your own screens. Unknown guards fail closed. Required checks are online policy,
not authentication or a tamper-proof access restriction. Offline check failure keeps
the running app usable unless a required candidate was already discovered or the running bundle requires a store/custom guard.

Calls are single-flight per action; a different action while busy rejects. Errors are
available in `error` and returned promises reject, so handle manual calls with try/catch.
Retry rechecks the server and reevaluates a pending candidate's custom guard.
Download reevaluates the fetched manifest's policy because it can differ from the
checked candidate. A pending bundle owns the gate until reload; checking another
candidate does not authorize an older cached bundle. Native rollback directives are
supported. Expo controls cold-start loading of already downloaded bundles; JS guards
cannot revoke that native cache. Store/custom guards are checked again from the running
manifest on the next launch; force OTA is already fulfilled by launching that bundle.
Do not mix direct expo-updates calls or native automatic
checks with hook orchestration: configure-app uses checkAutomatically=NEVER.

Legacy exports `checkForUpdateAsync`/`fetchUpdateAsync` remain identity-aware low-level
APIs for existing integrations. They intentionally do not implement hook policies.
No database/admin credentials are shipped: the server persists public heartbeat reports.

## Integration and customization

Use the stock `npm run configure-app -- ...` command from the server project. It
preserves the original app entry, generates the client and inserts the standalone component in
supported root components. For Expo Router this is `src/app/_layout` (preferred when
`src/app` exists) or `app/_layout`, including platform variants. For the default entry
it is `App`, provided no custom `index` registers a different root. Synchronous function
components and supported default-export forms are patched without changing navigation.
An unsupported root shape is rejected before writing; an unidentified custom root keeps
automatic identity/telemetry setup and emits a warning to connect the lifecycle manually.
The generated integration starts with:

```tsx
return (
  <>
    <OtaUpdates autoCheck autoUpdate={false} autoReload={false} />
    <AppTabs />
  </>
);
```

Adjust these options in the root component. Use `useOtaUpdates()` in other screens for
manual controls and shared state. The configurator selects the appropriate import path;
no database or admin credentials belong in the application. Generated source includes
`ota-client/docs/update-lifecycle.md` with this contract for application developers.

For an already configured project, review generated-file changes and rerun with
`--force`. This replaces the legacy JavaScript files with TypeScript, removes stale
`.js`/`.d.ts` copies that could shadow the new modules, and migrates the stock root
hook/gate while preserving its options. Custom code that uses the old root controller
or a custom gate must be migrated manually; the preflight stops before any writes.
Use `.tsx` for TypeScript JSX roots. Existing `OtaUpdateGate` consumers remain supported. Native dependencies need a new binary;
use a new runtime when older installed binaries lack those modules. Publishing remains
the generated `npm run ota:publish` workflow. See [device targeting](./device-targeting.md)
for selecting a smoke-test audience and [installation telemetry](./installation-telemetry.md)
for receipt/analytics semantics.

## Manual integration

Use this path when `configure-app` cannot patch your root component, your project
uses dynamic `app.config.*`, or you want to integrate the client yourself. The hook
is source code supplied by this repository, **not an npm package**. Do not import
it from `expo-updates`.

### 1. Prepare the client and native configuration

If `ota-client/index.ts`, `ota-client/types.ts` and `ota-client/config.json` already
exist after configuration, keep them and continue with step 2. A warning about an
unidentified custom root means the bootstrap/client were installed; an unsupported
root error stops configuration before writes, so check which files actually exist.

For an application with no generated client, run from the application directory:

```bash
npx expo install expo-updates expo-application expo-crypto expo-secure-store @react-native-async-storage/async-storage
```

Copy the **whole** `templates/expo-app/ota-client/` directory from the OTA server
repository to `<application>/ota-client/`. Keep its nested `model/`, `ui/`, runtime,
identity, telemetry and type declaration files together. For example, when the
application does not already contain that directory:

```bash
cp -R /full/path/to/expo-updates-server/templates/expo-app/ota-client ./ota-client
```

Create `<application>/ota-client/config.json`:

```json
{
  "channel": "preview",
  "heartbeatUrl": "https://updates.example.com/api/device-heartbeat",
  "identityNamespace": "https://updates.example.com"
}
```

Use your actual server URL. `channel` must equal the native `expo-channel-name`
request header. `identityNamespace` is a stable identity scope: preserve an existing
value when changing a tunnel/domain, runtime or channel. It contains no secret.
Do not copy an Installation ID, Device ID, database password or admin token into
this file: the client generates identities and sends public heartbeat requests.

Complete the [native Expo configuration](./expo-app-setup.md#_3-configure-the-expo-application):
server manifest URL, matching public signing certificate, runtime and channel.
Set `updates.checkAutomatically` to `NEVER`; checks must wait for identity setup.
Keep the signing private key and publisher credentials outside the mobile bundle.
A dynamic config must resolve the same channel used in `ota-client/config.json`.

### 2. Connect the root layout or App

For Expo Router, render the component beside navigation in the existing
`src/app/_layout.tsx`. Preserve your providers, fonts, splash-screen handling and
other layout code. Keep the component outside navigator-only child collections
such as `Stack.Screen`/`Tabs.Screen`.

```tsx
import { Stack } from 'expo-router';
import { OtaUpdates } from '../../ota-client';

export default function RootLayout() {
  return (
    <>
      <OtaUpdates autoCheck autoUpdate={false} autoReload={false} />
      <Stack />
    </>
  );
}
```

Adjust the relative import to the file location:

| Root file | Import from |
| --- | --- |
| `src/app/_layout.tsx` | `../../ota-client` |
| `app/_layout.tsx` | `../ota-client` |
| `App.tsx` at the application root | `./ota-client` |

For a non-Router application, render the same component beside the existing app
content. It can be a sibling of a class component too. Mount one instance, including
loading/early-return paths. A custom entry still registers the original root.

Keep an existing generated `ota-entry.js` and its `package.json.main` setting.
When integrating entirely by hand, changing the entry is **not required**: the
mounted hook calls the idempotent telemetry `start()` itself. Identity is persisted
before hook update requests; heartbeat network failures do not block rendering or
checks. Do not add another heartbeat implementation or call Expo checks at module
initialization. For an app that needs registration before its root mounts, the
public `start()` can also be called in its existing entry without replacing the
original registration code.

`OtaUpdates` supplies the default force-update UI. Using the hook without it
requires your own UI to enforce `blocked`. A custom gate view is supported through
`renderBlocked`; this does not change the controller's guard decision.

### 3. Add manual update controls

The root already provides download/restart controls. A separate settings screen is
optional and can subscribe without enabling another automatic workflow. For example, `src/components/ota-controls.tsx`:

```tsx
import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { useOtaUpdates } from '../../ota-client';

export function OtaControls() {
  const ota = useOtaUpdates();
  const [message, setMessage] = useState('');

  async function perform(action: () => Promise<unknown>) {
    try {
      setMessage('');
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <View>
      <Text>Installation: {ota.installationId ?? 'Initializing'}</Text>
      <Text>Device: {ota.deviceId ?? 'Unavailable'}</Text>
      <Text>State: {ota.status}</Text>
      <Text accessibilityLiveRegion="polite">{message || ota.error?.message}</Text>
      <Button title="Check OTA" disabled={!ota.enabled || ota.isBusy}
        onPress={() => { void perform(ota.check); }} />
      <Button title="Download OTA"
        disabled={!ota.enabled || ota.isBusy || !ota.available || ota.pending || ota.blocked}
        onPress={() => { void perform(ota.download); }} />
      <Button title="Restart with OTA"
        disabled={!ota.enabled || ota.isBusy || !ota.pending || ota.blocked}
        onPress={() => { void perform(ota.reload); }} />
    </View>
  );
}
```

The gate supplies required-update actions while these ordinary screen controls are
blocked. To download ordinary updates automatically, set `autoUpdate: true` in the
root; add `autoReload: true` only when automatic foreground restarts suit your app.
Server `background` delivery still prevents an automatic immediate restart. Custom
guards need an explicit `guardHandlers[action]` decision; returning `allow` should
follow your actual application condition, not simply silence an unknown action.

### 4. Rebuild and verify

After adding native dependencies or changing URL/runtime/channel/certificate,
prebuild and install a new release binary. Use the environment required by a dynamic
config when running Expo commands. Expo Go and ordinary development mode do not
exercise this client's telemetry/update lifecycle.

1. Check TypeScript and lint, then build/install the release binary.
2. Launch it and verify an installation appears under `/updates/devices`.
3. Publish a fresh OTA **after** building the binary, for its exact scope, then activate it.
4. Check → download → restart; verify the new running version in the admin panel.
5. Confirm Installation ID is unchanged after OTA. A reinstall may change it;
   Device ID persistence has the [platform limitations](./device-targeting.md).
6. Check background delivery, force OTA, store upgrade and your custom guards separately.

Copying `ota-client/` and adding the hook does not install publisher scripts or
embedded-build registration. Those are separate setup steps in the
[application guide](./expo-app-setup.md#_6-register-embedded-updates). If the automatic
configurator already installed them, keep using its `npm run ota:publish` command.
The bundled publisher reads static `app.json` only: manual hook integration does
not make a dynamic `app.config.*` project a supported end-to-end publishing setup.
Such projects need separate publisher/build integration before step 3 above.
