# Device-targeted OTA releases

A release has an audience (`all` or `devices`) independently of its delivery/guard policy.
The audience is checked before choosing a manifest. Runtime, channel and platform still
have to match. A force-update guard does not bypass the audience.

## Smoke test, then release

1. Configure the application with `npm run configure-app`. The generated `ota-entry.js`
   starts the client before the original Router/custom entry; no manual hook or ID wiring
   is required. Existing generated files can be refreshed with `--force` (review local edits).
2. Rebuild the native app after adding `expo-secure-store`; use a new runtime so older
   binaries cannot download JavaScript importing a missing native module.
3. Open the app. In **Установки → installation details**, copy its Device ID or name it
   **Мой телефон**. Older clients still report Installation ID and can be targeted by it.
4. Publish with the generated `npm run ota:publish -- --platform android --message "Smoke"`.
   Publishing creates a draft. In its detail page select **Аудитория обновления → Только
   выбранные устройства / установки**, choose your phone, and **save before activation**.
5. Activate the draft. Your device gets it; other compatible devices get the previous
   eligible public update, or no update if one does not exist.
6. After testing, set the audience to **Все совместимые устройства** and save. The same
   artifact is now eligible for everyone. No second publish is needed.

Changing an active audience affects future checks immediately. It does not uninstall or
revoke cached/downloaded OTA bundles. Use the existing rollback flow to change the running
version. Targeting is a rollout mechanism, not authentication or confidential asset storage:
client IDs can be supplied by a modified client and asset URLs remain accessible.

## Two identities

- **Installation ID**: random UUID in AsyncStorage. Continues through OTA, changes after
  uninstall/clear data. It remains the unit counted in installation/cohort analytics.
- **Device ID**: SHA-256 value scoped to the app ID and an OTA-server namespace. On Android,
  the input is `expo-application.getAndroidId()` (signing key + Android user + device). On
  iOS, the input is a random UUID stored through `expo-secure-store` with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so a backup restored on a different phone does not
  deliberately copy this identity. Raw platform IDs are never sent to the server.

Android reinstall with the same signing key normally keeps Device ID. Factory reset,
Android user/profile or signing key changes can change it. iOS Keychain often survives
reinstall with the same bundle ID, but persistence across uninstall is not guaranteed.
If Device ID changes, select the new device in the audience again. There is no universal,
permanent physical-device identity. The admin name belongs to Device ID, not Installation ID.

`ota-client/config.json.identityNamespace` is preserved on reconfiguration, including
server/tunnel URL changes. Keep this generated file with application source. Runtime and
channel are deliberately not part of Device ID. A separate application or server should
use its own namespace.

Official API references: [Expo Application](https://docs.expo.dev/versions/v58.0.0/sdk/application/),
[Expo SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/),
[Expo extra parameters](https://docs.expo.dev/versions/v58.0.0/sdk/updates/#updatessetextraparamasynckey-value).

## Client initialization

Generated entry calls `start()` automatically, persists installation identity and sets
`installation_id` / `device_id` via `Updates.setExtraParamAsync`. Heartbeat adds optional
`deviceId`. The durable queue and monotonic per-installation sequence are unchanged.
An unavailable Device ID does not stop installation telemetry; device targeting fails closed.
The iOS identity read retries after temporary Keychain failure without replacing its seed.

For custom check/download UI use the generated `checkForUpdateAsync` and `fetchUpdateAsync`:
these wait for initialization. Direct calls to `expo-updates` before initialization can
perform an anonymous check; anonymous clients only receive public updates. Configuration
sets `checkAutomatically: NEVER`, preserving explicit update-check control. The initializer
itself does not download/reload updates or alter application navigation.

Optional `getInstallationId()` / `getDeviceId()` exports are for displaying diagnostics,
not required to register the device. Both return null when updates are disabled (web/dev).

## Server migration and behavior

Apply `docs/migrations/2026-10-22-device-targeting.sql` after the analytics/version migrations,
before deploying the server. Fresh installations use `docs/migrations/schema.sql`.
Then apply `docs/migrations/2026-10-22-device-targeting-activation.sql` before deploying
server changes from the cross review. It atomically applies the public/targeted activation
rules, preserves deactivation during a global stop, and adds the `ota-force-update` guard
catalog entry alongside the separate native/store update action. Both migrations are
repeatable and do not change the audience or active state of existing releases.

The targeting migration removes the single-active-release index because a targeted
release must coexist with its public fallback. Existing releases have audience `all`.

Activation, rollback and promotion of a targeted release preserve other active releases.
Normal public activation keeps the previous behavior of disabling older releases.
Widening an already-active targeted release leaves the prior public fallback eligible;
the newer release wins selection. Disabling the targeted release restores fallback selection.
Explicit rollback has priority, subject to the same audience and compatibility checks.
Emergency pinned redirects still fail closed when the selected artifact differs.

Admin API:

- `GET/PUT /api/admin/updates/:encodedKey/audience` uses existing read/write permissions.
  PUT replaces mode and both ID lists with `audience_version` for optimistic concurrency.
  At least one target is required in `devices` mode; maximum 100 IDs of each type.
  The DB serializes audience changes with the emergency distribution switch.
- `GET /api/admin/device-targets?platform=android|ios` requires an admin session and lists
  the latest 500 installations, including old runtimes. UI search shows up to 50 matches;
  older IDs can be entered manually.
- `PUT /api/admin/device-targets` names a Device ID (admin/operator session only).

Manifest requests read the Expo Structured Field Dictionary `Expo-Extra-Params`.
Missing/malformed IDs never match a private audience. Responses use `private, no-store`.
Selection applies eligibility before the latest-active fallback query, never after taking
only one unfiltered row. Accepted heartbeats can associate a new installation with the same
Device ID; duplicate/stale events do not relink it or merge installation history.

For isolated local Docker configurations, `configure-app --server-env .env.ota-test` uses
that file's published database/storage ports when generating `.env.ota`.

## Verification

`npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run installer:check` cover server and
packaging checks. Run `OTA_TEST_DATABASE_URL=... node scripts/tests/device-targeting.mjs`
against a migrated disposable/test DB for real PostgreSQL eligibility, compatibility,
CAS, global block and reinstall tests. Fixtures are rolled back. Device reinstall/Keychain
behavior additionally requires physical-device testing with the native build.

Activation and audience changes are serialized in PostgreSQL. Public activation disables
other active releases in the same scope within the same statement; a failed activation
cannot partially disable the previous public release. This also covers the existing
`update-meta.json` editor. Targeted activation preserves other audiences. During a global
stop, deactivation can repair stale pointers to the remaining active fallback; activating,
promoting a live rollback, and changing audiences stay blocked.

Run `scripts/tests/device-targeting-activation.mjs` against an **empty disposable database**
with the complete schema to check concurrent audience changes, failed activation atomicity,
and incident deactivation. It refuses a database containing releases. The analytics
migration runner also checks this suite for both fresh and upgrade paths.
