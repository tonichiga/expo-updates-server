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

Policy becomes immutable when an update is activated, promoted, or used as a
rollback target. Publish a new update ID when policy needs to change.
