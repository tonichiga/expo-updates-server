---
layout: home

hero:
  name: Expo Updates Server
  text: Own your Expo OTA delivery
  tagline: Self-host signed updates, promote releases deliberately, roll back safely, and recover misconfigured native builds.
  actions:
    - theme: brand
      text: Install with NPX
      link: /npm-installer
    - theme: alt
      text: Quick Start
      link: /getting-started
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

## Install in seconds

Create a new project directory:

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

Or initialize the current empty directory:

```bash
npx create-expo-updates-server@latest .
```

The initializer bundles and verifies the complete server template. Continue
with the [npm initializer guide](/npm-installer) for Docker and local npm
startup commands.

## Choose your path

Create a standalone project with the
[npm initializer](/npm-installer), or start locally with the
[English Quick Start](/getting-started) or
[Russian Quick Start](/getting-started.ru). For a hosted database and object
storage, follow the [Supabase setup](/supabase-setup).

When the server is ready, connect a native application with the
[Expo application setup](/expo-app-setup), then use the
[operations guide](/operations-guide) for production deployment, backups,
rollbacks, and incident response.

## Project actions

- [Open the GitHub repository](https://github.com/tonichiga/expo-updates-server)
- [Report a bug](https://github.com/tonichiga/expo-updates-server/issues/new)
- [Improve the documentation](https://github.com/tonichiga/expo-updates-server/edit/main/docs/index.md)
