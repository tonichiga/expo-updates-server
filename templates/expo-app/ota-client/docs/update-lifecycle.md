# Update lifecycle

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
