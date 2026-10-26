---
layout: home

hero:
  name: Expo Updates Server
  text: See what’s running.<br>Choose who updates.
  tagline: Signed OTA updates, installation analytics, and device targeting for your Expo apps. All on your own infrastructure.
  actions:
    - theme: brand
      text: Quick Start
      link: /getting-started
    - theme: alt
      text: Create project with NPX
      link: /npm-installer
    - theme: alt
      text: View on GitHub
      link: https://github.com/tonichiga/expo-updates-server

features:
  - icon: 🚀
    title: Controlled OTA releases
    details: Publish updates as inactive, inspect their runtime, channel, and platform, then activate them when ready.
  - icon: 🔐
    title: Signed manifests
    details: Deliver Expo-compatible manifests protected by your own RSA code-signing key pair.
  - icon: ↩️
    title: Rollback and promotion
    details: Pin a channel to a known update during an incident and resume the latest release after recovery.
  - icon: 🛟
    title: Emergency redirects
    details: Recover a specific embedded build that shipped with the wrong native channel without redirecting an entire runtime.
  - icon: 🗄️
    title: Flexible infrastructure
    details: Run PostgreSQL with S3-compatible storage, use Supabase, or launch the complete local stack with Docker and MinIO.
  - icon: 👥
    title: Operator-ready
    details: Manage role-based access, scoped automation tokens, embedded builds, and release history from the admin panel.
---

## From project files to the first OTA

Start with the [Quick Start](/getting-started).
It covers project creation, Docker, signing keys, administrator setup, connecting
an Expo app, installing a native release and publishing the first OTA.

The [npm initializer](/npm-installer) creates the server files; it is also the
starting point for Docker or [hosted Supabase infrastructure](/supabase-setup).

Already have a running server? Continue with [Expo application setup](/expo-app-setup).
For an unsupported app structure, see [manual client integration](/ota-client-lifecycle#manual-integration).
For ongoing deployment, backups and recovery, use the [operations guide](/operations-guide).

## Project actions

- [Open the GitHub repository](https://github.com/tonichiga/expo-updates-server)
- [Report a bug](https://github.com/tonichiga/expo-updates-server/issues/new)
- [Improve the documentation](https://github.com/tonichiga/expo-updates-server/edit/main/docs/index.md)
