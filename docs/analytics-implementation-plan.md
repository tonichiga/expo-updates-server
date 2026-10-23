# Installation analytics: implementation status

The installation registry and current version adoption are implemented. Follow
[Installation telemetry](./installation-telemetry.md) for setup, migrations,
client behavior, API contracts and regression checks.

The earlier draft on this page is superseded. The implementation uses a separate
launch heartbeat and an AsyncStorage envelope with sequence/outbox persistence.
It does not infer launched versions from update checks or downloads. Manifest
identity mappings are recorded at serving time, not speculatively on activation.

The built-in app configurator installs the generated client and preserves the
original application entry. The admin **Установки** page shows installations and
current version shares for recently observed devices.

Next: installation allowlists for private smoke delivery, followed by widening a
release to everyone. Targeting must be enforced by the server's selection and
asset delivery rules; the self-reported installation ID is not authentication.
