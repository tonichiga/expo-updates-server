# Installation registry and version adoption

For an existing database, apply the migrations in the
[operations guide](./operations-guide.md#installation-telemetry) before deploying
the server. Fresh installs use `schema.sql`, which includes telemetry, analytics,
version metadata, device audiences and atomic activation.

Run the existing `npm run configure-app -- ...` workflow. It installs compatible
`expo-updates`, `expo-application`, `expo-crypto`, `expo-secure-store` and AsyncStorage
dependencies, creates `ota-client/` and a synchronous `ota-entry.js` bootstrap, and
preserves the original entry in `ota-client-entry.json`. The configurator also patches
the root layout/App with `useOtaUpdates` and `OtaUpdateGate`; application authors do not
have to generate IDs, send heartbeats, or wire update methods by hand. Supported roots
are described in the [client lifecycle guide](./ota-client-lifecycle.md).

Reruns preserve the original entry. Changed generated files require the existing
`--force` option; review local customizations before replacing them. Custom Android build
scripts remain intact. Introducing these native modules requires rebuilding the binary
and using a compatible runtime. An OTA alone cannot add a missing native module.

Open `/updates/devices` (the **Installations** link in the admin panel). It shows:

- Installation IDs, platform/channel, runtime, native version/build, actual launch
  ID and resolved artifact, emergency launch flag, and last server receipt.
- Current version distribution among installations seen in the last 24 hours,
  7 days, or 30 days. Filters cover platform, channel, runtime, launch kind and
  all or part of an installation UUID. Filter options come from recorded data;
  pagination affects only the installation list, not the summary or charts.
- `embedded`, resolved `ota`, or explicit `unknown` status. A download/check is
  never counted as a launched version. Repeated launches do not multiply devices.
- UTC daily activity, the current composition of first-seen cohorts, and a
  separate retention matrix with explicit collection coverage.

## Analytics upgrade

For a database that already has installation heartbeats, apply the migration
before deploying the updated server:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f docs/migrations/2026-10-22-device-analytics.sql
```

This follows the database connection convention in the
[operations guide](./operations-guide.md#installation-telemetry). The migration
is safe to reapply: it preserves installation state and the original collection
start. Existing mobile clients with heartbeat support require no new native
dependencies for these analytics. After deploying the server, open
`/updates/devices` using an admin session; the page contains the analytics tabs
and installation registry.

The migration creates daily activity facts, immutable cohort entry facts, and
collection metadata. Accepted heartbeats update the registry and daily facts
in the same transaction. There is one daily row per installation/platform/UTC
day, containing the last accepted snapshot for that day. Duplicates and stale
events do not create activity or change daily timestamps.

## What each view measures

| View | Population and time window | Meaning of filters |
| --- | --- | --- |
| Summary, versions and installation registry | Last reported state of installations with an accepted heartbeat in the last 24 hours, 7 days or 30 days | Latest reported platform/channel/runtime/launch kind; installation ID search |
| Daily activity | One point per UTC calendar day, including today, for the selected 1/7/30-day period | Last accepted snapshot of each installation on that day |
| Adoption cohorts | The same recently active population as the summary, grouped by the UTC week of registry `first_seen_at` | Latest reported state; composition of each group today |
| Retention cohorts | First instrumented observations recorded since analytics collection began, within the last 90 UTC days, independently of the selected activity period | State at cohort entry; later return activity can occur on any channel/runtime/launch kind |

The registry uses a rolling time window, while daily charts use calendar days.
For example, the 24-hour registry can include a heartbeat from yesterday even
when the one-day chart shows only today. Channel/runtime/launch-kind changes can
also make the current-state and daily-snapshot populations differ. Counts refer
to installations, not unique people or physical phones.

Daily **newly observed** counts are first instrumented observations recorded
after collection starts. An already instrumented installation that sends its
first post-upgrade heartbeat contributes to daily activity but does not become
a new installation or a new retention-cohort member. The optional
`summary.newInstallations` API field instead uses registry `first_seen_at`
within the selected rolling window, so it can include observations predating
daily collection.

Adoption cohorts are current composition, not retention. They remain useful
immediately after upgrading because existing installations have registry
first-seen timestamps, even when no daily history exists yet.

### Retention and coverage

Retention is based on accepted heartbeat receipts on exact UTC days since the
first instrumented observation. D0 is the observed baseline. D1, D7, D14 and D30
count members with an accepted heartbeat on that exact later day, rather than
members who returned at any time during the intervening period. Weeks start on
Monday in UTC.

For D1 and later, only members whose target UTC day has ended enter the eligible
denominator. Each cell includes `eligibleInstallations`, `retainedInstallations`
and `rate` (a fraction from 0 to 1). A partially mature cohort can therefore
have a smaller denominator than its total membership. No eligible members means
`null`, not zero. D0 includes newly observed members today.

History before collection is unavailable and is never reconstructed from
`last_seen_at` or version transitions. The daily chart returns `null` for such
days. A covered day without accepted heartbeats returns zero. The collection
start day and today are marked partial. The response exposes
`coverage.collectionStartedAt`, `retainedFrom`, `timezone`, `retentionDays` and
`cohortWindowDays` so consumers can show these boundaries.

Daily facts and retention cohorts have a 90-day retention window. The first
accepted heartbeat each UTC day prunes expired facts; subsequent heartbeats
that day avoid repeating the cleanup. Reports exclude expired days even before
cleanup runs. An installation with no traffic does not trigger cleanup; a
scheduler can also call `select public.ota_prune_device_activity();`. Registry
state and the existing transition log are separate from this retention policy.

## Client contract

`POST /api/device-heartbeat`, JSON only, at most 8192 bytes (enforced while reading):

```json
{
  "installationId": "b1c01662-c4e1-41a0-8556-a6c2a9dee467",
  "eventId": "d28a640f-f4c3-47ae-9044-58a950ad6d38",
  "sequence": 1,
  "observedAt": "2026-10-19T12:00:00.000Z",
  "platform": "android",
  "channel": "production",
  "runtimeVersion": "1.0.0",
  "updateId": null,
  "nativeVersion": "1.0.0",
  "nativeBuild": "1",
  "isEmbeddedLaunch": true,
  "isEmergencyLaunch": false
}
```

Responses return `status: accepted | duplicate | stale`. A reused sequence with a
different event ID is 409; malformed input is 400, oversized input 413, unsupported
content type 415, unavailable storage 503. Sequence is a positive safe integer.
Only accepted events refresh `last_seen_at`; client time is diagnostic, not the
basis for activity windows. An offline event's receipt does not prove the device
is still online. Daily activity is derived from server receipts after analytics
collection begins; it does not reconstruct offline usage or historic DAU.

The durable AsyncStorage envelope contains identity, sequence and a one-event
outbox. Startup and active foreground report the launched version; foreground
retries use a capped backoff and an 8-second request timeout. Pending snapshots
may be coalesced, so offline transitions are not an exhaustive audit log. Database
state and observed version transitions commit atomically. Epoch changes pointing
to the same artifact do not create fake version transitions. Resolved snapshots
survive deletion of the artifact for a device still reporting that launch ID.

The generated `useOtaUpdates(options)` hook exposes shared candidate/download state,
`check()`, `download()`, `reload()`, `retry()` and store upgrade handling. Identity is
persisted and the `installation_id` and `device_id` Expo extra parameters are set before
checks/downloads. Root options configure automatic checks, downloads and reloads;
server delivery/guard policy controls background and required updates. See the
[client lifecycle guide](./ota-client-lifecycle.md) for the complete contract.

The compatibility exports `getInstallationId()`, `getDeviceId()`,
`checkForUpdateAsync()` and `fetchUpdateAsync()` remain available. Low-level check/fetch
wrappers wait for identity but do not apply hook policies. Direct Expo checks at module
initialization are not intercepted. Do not mix those calls with hook orchestration.
The configured native automatic check is `NEVER`; the hook performs checks after
initialization. Dev/Expo Go/web builds do not report.

A heartbeat describes the running bundle, never a checked or merely downloaded candidate.
For an OTA served through an emergency redirect, its signed `manifest.metadata.channel`
is the reported channel; embedded launches use the configured channel. Resolver scope
checks remain strict. A failed telemetry request does not block checks or app launch.

## Scope and access

An installation ID is not a physical device identifier or user ID. App data
clearing/reinstallation may create a new ID; OS backup/restore may copy local
storage. Accounts are outside this feature. A separate app/server-scoped Device ID supports
reinstall-resistant targeting; it does not merge installations or identify a person.
Heartbeat is self-reported, unauthenticated telemetry, not an authorization or
health attestation. It contains no admin/database/S3 token. Protect the public
endpoint with deployment-level request limits appropriate to your traffic; forged
clients can submit telemetry. Do not use this registry alone to grant secrets.

Reports require an admin session (admin/operator/viewer); publisher access tokens
cannot list installation IDs. RPC/table access is revoked from PUBLIC, anon and
authenticated roles; the server uses the table owner or Supabase service_role.
If you use a separate PostgreSQL runtime role, grant it the necessary table,
sequence and function privileges and configure RLS policies deliberately.

[Device audiences](./device-targeting.md) support smoke-only delivery to selected
Device IDs or Installation IDs and widening the same release to everyone. This is
release targeting, not a general feature flag rule engine.

## Regression checks

```sh
npm test
npx tsc --noEmit
npm run build
# Disposable database only, after applying migrations:
export OTA_TEST_DATABASE_URL=postgresql://...
node scripts/tests/device-heartbeat.mjs
# Fresh disposable database with schema.sql applied:
export OTA_TEST_DATABASE_URL=postgresql://...
node scripts/tests/device-analytics.mjs
# Empty disposable database: upgrade path, then the analytics regressions above:
export OTA_TEST_DATABASE_URL=postgresql://...
node scripts/tests/device-analytics-migrations.mjs
# A separate empty disposable database: fresh canonical schema path:
export OTA_TEST_DATABASE_URL=postgresql://...
node scripts/tests/device-analytics-migrations.mjs --fresh
```

The database check covers unknown/resolved/embedded launches, duplicates, stale
requests, sequence conflicts, same-artifact epoch rotation, artifact deletion,
scoped/freshness statistics, and simultaneous first registration. Client tests
cover durable retries, storage failures, concurrent observations and stale acks.

Analytics checks cover daily deduplication and concurrent writes, snapshot versus
entry-state segmentation, filters and pagination-independent aggregates, missing
history versus zero activity, retention maturity, and 90-day cleanup. Migration
checks verify existing rows remain unchanged, no history is fabricated, and
reapplying a migration preserves collection start. They use only the explicitly
provided `OTA_TEST_DATABASE_URL`; they never load `.env` or `.env.local`. The
migration runner requires an empty disposable database owned by its connection
role and leaves its schema installed for inspection. Analytics tests temporarily
adjust collection metadata and exercise cleanup; never run them on a live database.

## Versions in the chart {#версии-на-графике}

The chart groups versions by runtime, channel and platform. Each OTA's share is calculated within that group, not across all channels. `appVersion` comes from the published manifest (`extra.expoClient.version`, then `expoClient.version`); the message remains a comment and is not used as a version name. The OTA ID distinguishes releases with the same `appVersion`. When OTA metadata is unavailable, the interface explicitly shows “Version not specified” instead of substituting the native version.

One OTA running on multiple native builds appears as one bar; the original rows remain in the All versions table. For an existing database, apply `docs/migrations/2026-10-22-device-version-metadata.sql` after the analytics migration. New databases receive the change through `schema.sql`. The migration does not change installed versions or delivery policies.

## Device targeting

See [Device-targeted releases](./device-targeting.md) for the separate reinstall-resistant Device ID, automatic configurator integration and smoke-test rollout workflow. Installation analytics still count installations, not deduplicated physical phones.
