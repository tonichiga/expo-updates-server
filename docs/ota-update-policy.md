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

**Download on postpone** sends `delivery: "manual"` with `onPostpone: "download"` in the signed manifest. A patched client asks first, downloads silently after Postpone, and keeps the current session running. Older clients use their existing manual behavior. Upgrade the client before enabling the new profile. Existing databases require `2026-11-25-download-on-postpone.sql`.

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
- An unguarded `background` release downloads silently and applies on the next cold start.
- Legacy clients safely ignore the additional `extra` value.

An inactive upload is a draft, even though its initial `disabled_at` value is
equal to `created_at`. Its delivery mode and simple Guard remain editable until
activation. `disabled_at` by itself is not evidence that an update was
published.

Uploading a draft leaves the serving pointers unchanged. The console updates them when an operator activates, stops, promotes, rolls back or restores a release. On an older database a historical pointer can identify an inactive upload. Only activation or evidence of a served manifest establishes publication.

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

Choose a policy profile for the draft, configure its fields and save the changes. Custom Guard actions can be selected from the catalog or created in the picker. The catalog can also be edited independently while viewing an immutable policy.

Persisted catalog entries can be removed with the trash control. Catalog
deletion does not modify an existing policy. Its action remains visible as a
synthetic option until deliberately changed, and synthetic options have no
delete control.

Catalog action keys are trimmed when created, contain 1–100 characters, and
cannot contain control characters. Viewers can list catalog entries but cannot
create or delete them.

## Client hook {#generated-client-hook}

The configurator imports `OtaUpdates` from `expo-updates-server-client` and mounts it beside navigation. The component uses `useOtaUpdates(options)` to enforce the release policy. See the
[client lifecycle guide](./ota-client-lifecycle.md) for configuration and methods.
The hook evaluates the candidate policy from `check()`, then validates the fetched
manifest again because the selected release may change between checking and downloading.

- With `manual` delivery, `ota-force-update` downloads a compatible OTA and shows a required restart action when ready.
- With `background` delivery, `ota-force-update` downloads silently and automatically reloads once the signed update is ready and the app is active, even with `autoReload: false`. If the app is inactive it resumes on foreground. A failed download or reload shows a required retry action.
- `ota-force-store-update` requires a **new native binary**: the gate opens the platform
  store URL; it does not download this OTA candidate. OTA cannot change runtime or add
  native modules. Payload supports `androidUrl`, `iosUrl`, or a shared `url` fallback.
- Unknown/custom actions remain blocked until an explicit `guardHandlers[action]`
  returns `allow`. Catalog entries alone do not implement guard behavior.
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
