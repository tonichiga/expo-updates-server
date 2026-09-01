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

`guard` is omitted when no enabled rule matches the request. Rules are
evaluated server-side after update selection; clients only consume the winning
action.

- `Updates.checkForUpdateAsync()` returns the policy on the **candidate**
  manifest in the check result.
- `Updates.manifest` contains the policy of the update that is **currently
  running**. Do not use it as the candidate policy before downloading.
- `manual` is the default and leaves fetch/reload behavior to the application.
- `background` means fetch the candidate silently, do not reload immediately,
  and apply it on the next cold start.
- Legacy clients safely ignore the additional `extra` value.

An inactive upload is a draft, even though its initial `disabled_at` value is
equal to `created_at`. Its delivery mode and guard rules remain editable until
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

Databases that already ran the original policy migration should also run
`docs/migrations/2026-09-01-correct-draft-policy-publication.sql`.
Operators that use `docs/migrations/schema.sql` as their upgrade path receive
the same correction after the served-manifest log table is available.
The corrective migration is idempotent and only unlocks conservative,
never-published draft signatures without served-manifest evidence or an active
rollback pointer. A `latest_update_id` reference does not prevent correction.
