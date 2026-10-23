# OTA update policy client contract

Every served update manifest includes `extra.updatePolicy`:

```json
{
  "schemaVersion": 1,
  "policyVersion": 2,
  "delivery": "background",
  "guard": {
    "action": "require-confirmation",
    "payload": { "message": "Restart when ready" }
  }
}
```

The `guard` property is omitted when no Guard is configured. A configured
Guard is unconditional: it is included for every client to which the existing
runtime, channel, platform, audience and update selection logic serves that OTA.
A force guard never bypasses a device audience.
Catalog membership is advisory and is not required to save or serve an action.

- `Updates.checkForUpdateAsync()` returns the policy on the **candidate**
  manifest in the check result.
- `Updates.manifest` contains the policy of the update that is **currently
  running**. Do not use it as the candidate policy before downloading.
- `manual` is the default and leaves fetch/reload behavior to the application.
- `background` means fetch the candidate silently, do not reload immediately,
  and apply it on the next cold start.
- Legacy clients safely ignore the additional `extra` value.

An inactive upload is a draft, even though its initial `disabled_at` value is
equal to `created_at`. Its delivery mode and simple Guard remain editable until
activation. `disabled_at` by itself is not evidence that an update was
published.

`ota_update_channels.latest_update_id` identifies the newest upload and may
therefore point to an inactive draft. That pointer is not publication evidence;
manifest selection falls back to the latest active update. An
`active_update_id` rollback pointer or an `ota_served_manifest_log` row is
publication evidence.

Activation is the publication event. Once activated, promoted, used as a
rollback target, or demonstrably served, a policy remains immutable even if the
update is later disabled. Publish a new update ID when policy needs to change.

## Production upgrade order

Back up the database. Existing installations should apply these idempotent
migrations in order:

```bash
psql "$DATABASE_URL" -f docs/migrations/2026-09-01-p1-guard-actions.sql
psql "$DATABASE_URL" -f docs/migrations/2026-09-01-p2-simplify-ota-guard-policy.sql
psql "$DATABASE_URL" -f docs/migrations/2026-09-01-policy-publication-correction.sql
```

The simplification migration deliberately drops `guard_rules` without
converting old rules. It adds nullable `guard_action` and `guard_payload`
columns and recreates the policy immutability trigger for the simple model.
The final corrective migration only clears incorrectly inferred publication
markers for conservative, inactive, never-served default policies. It does not
unlock active, rollback, or served updates.

Environments that already successfully ran
`2026-09-01-policy-publication-correction.sql` and verified that no drafts
remain falsely marked as published may skip the third step. Otherwise, the
correction must run third because it references the `guard_action` and
`guard_payload` columns created by the simplification migration.

Supabase users can run the same files in SQL Editor in the listed order. Fresh
installations should apply only the canonical
`docs/migrations/schema.sql`, which contains the simple model.

## Guard action catalog

The policy editor loads reusable action names from `ota_guard_actions`. New
installations receive the separate `ota-force-update` and `ota-force-store-update`
actions. Operators can create
an action by typing it in the action combobox or through the catalog-only form,
which remains available while viewing an immutable policy and never changes
that policy.

Persisted catalog entries can be removed with the trash control. Catalog
deletion does not modify an existing policy. Its action remains visible as a
synthetic option until deliberately changed, and synthetic options have no
delete control.

Catalog action keys are trimmed when created, contain 1–100 characters, and
cannot contain control characters. Viewers can list catalog entries but cannot
create or delete them.

## Generated client hook

The configurator installs `useOtaUpdates(options)` and automatically connects it in the
root layout/App, with `OtaUpdateGate` around application content. See the
[client lifecycle guide](./ota-client-lifecycle.md) for configuration and methods.
The hook evaluates the candidate policy from `check()`, then validates the fetched
manifest again because the selected release may change between checking and downloading.

- `ota-force-update` requires a compatible **OTA**: the gate blocks interaction, the
  hook downloads the update and shows a restart action when ready.
- `ota-force-store-update` requires a **new native binary**: the gate opens the platform
  store URL; it does not download this OTA candidate. OTA cannot change runtime or add
  native modules. Payload supports `androidUrl`, `iosUrl`, or a shared `url` fallback.
- Unknown/custom actions remain blocked until an explicit `guardHandlers[action]`
  returns `allow`. Catalog entries alone do not implement guard behavior.
- `delivery: background` downloads silently and waits for a cold launch or a manual
  reload. It does not immediately reload because `autoReload` is enabled.
- A manual candidate is displayed for explicit download/reload unless root options
  enable `autoUpdate`/`autoReload`. The generated root enables automatic checks only.

The gate is required to block the application's UI; a hook alone only exposes state.
Before a required candidate has been discovered, offline check failure leaves the
running app usable. Expo may apply a previously downloaded bundle at native startup;
JavaScript cannot revoke that native cache. These are delivery policies, not client
authentication. Legacy clients may ignore policy fields, so deploy the configured native
client before relying on a guard.

Existing installations receive the new OTA guard catalog entry through
`2026-10-22-device-targeting-activation.sql`, after the targeting migrations listed in
the [operations guide](./operations-guide.md#installation-telemetry). The migration is
idempotent and does not rewrite published policies.
