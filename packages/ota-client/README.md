# expo-updates-server-client

Installation telemetry, update checks and update UI for Expo apps using a self-hosted Expo Updates Server. The server's `configure-app` command installs the SDK, generates the entry bootstrap and mounts `OtaUpdates` in supported app layouts.

## Manual installation

Install the SDK in the Expo app and let Expo choose native dependencies compatible with the app's SDK.

```sh
npm install expo-updates-server-client
npx expo install expo-updates expo-application expo-crypto expo-secure-store @react-native-async-storage/async-storage
```

Configure the native updates URL, runtime version, signing certificate and request headers for your server. Set `updates.checkAutomatically` to `"NEVER"` when using the SDK's check lifecycle. Build a new native binary when adding native dependencies. [Expo app setup](https://tonichiga.github.io/expo-updates-server/expo-app-setup)

Initialize the client in the app entry before loading the original entry. This example uses Expo Router.

```js
const { initializeOtaClient, start } = require("expo-updates-server-client");
initializeOtaClient({
  channel: "production",
  heartbeatUrl: "https://updates.example.com/api/device-heartbeat",
  identityNamespace: "https://updates.example.com",
});
start();
require("expo-router/entry");
```

Point the app's `package.json.main` at that entry. `start()` registers telemetry without waiting for the network. Repeated initialization with the same settings and repeated calls to `start()` are safe. The SDK rejects conflicting settings in the same JavaScript session.

Mount the optional update UI beside the app's navigation in a persistent root.

```tsx
import { Slot } from "expo-router";
import { OtaUpdates } from "expo-updates-server-client";

export default function RootLayout() {
  return (
    <>
      <Slot />
      <OtaUpdates />
    </>
  );
}
```

`OtaUpdates` checks on mount and foreground, prompts for optional manual updates and enforces required-update policies. For custom UI, `useOtaUpdates()` exposes the same controller with automation off by default. `OtaUpdateGate` remains available for existing layouts. [Update lifecycle and options](./docs/update-lifecycle.md)

## Identity and telemetry

`getInstallationId()` returns the persisted installation UUID. `getDeviceId()` returns the scoped device ID when available. Identity-aware `checkForUpdateAsync()` and `fetchUpdateAsync()` wait for identity registration before calling Expo. The SDK disables telemetry on web and in development or updates-disabled builds.

The SDK preserves the generated client's AsyncStorage keys, heartbeat sequence, pending event and iOS Keychain seed. When migrating, pass the existing `identityNamespace` from `ota-client/config.json`. Keeping the namespace stable preserves device targeting across server URL and channel changes. Android derives the device ID from the app-scoped Android ID. iOS uses a seed stored in SecureStore. Both identifiers serve telemetry and targeting.

Active apps report the running bundle up to once per minute. One pending snapshot survives offline operation and retries with up to five minutes of backoff. The app entry and update checks can proceed while the heartbeat request is in flight.
