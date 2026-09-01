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
runtime, channel, platform, and update selection logic serves that OTA.
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
installations receive the `ota-force-store-update` action. Operators can create
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
