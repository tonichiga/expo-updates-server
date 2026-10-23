# Expo Updates Server

Self-hosted OTA delivery for Expo applications, with signed manifests, an admin
panel, device targeting and installation analytics.

- Publish inactive updates, review their audience, then activate them.
- Track running app versions by runtime, channel and platform.
- Test a release on selected devices before making it available to everyone.
- Integrate identity, telemetry and manual/automatic updates through a generated
  `useOtaUpdates` hook, including background delivery and required-update policies.
- Run PostgreSQL and S3-compatible storage locally with Docker, or use Supabase.

## Start here

Create a server project:

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

The initializer creates files; it does **not** start services, install dependencies
or generate credentials/signing keys. It contains the template from its published
version, not unpublished changes on GitHub or in a local checkout.

Continue with the **[Quick Start](docs/getting-started.md)**
([Русский](docs/getting-started.ru.md)). It covers one complete path:

1. Prepare Docker, server settings and a signing key pair.
2. Start the server and create an administrator.
3. Give the phone a reachable HTTPS endpoint.
4. Run `configure-app`, then build and install a native release.
5. Make a JS change, publish an OTA and activate it for the intended audience.

Use [Supabase setup](docs/supabase-setup.md) for hosted infrastructure.
Cloning this repository is also supported; use the same quick start from the
checkout. For initializer options and filesystem behavior, see
[the npm initializer guide](docs/npm-installer.md).

## Application integration

Run `npm ci` in the **server directory** before `npm run configure-app`.
The configurator supports static `app.json` projects and installs the client,
root hook, publisher and embedded-build registration scripts. See
[Expo application setup](docs/expo-app-setup.md) for supported roots and flags.

If generation cannot be used, follow [manual client integration](docs/ota-client-lifecycle.md#manual-integration).
This fallback wires the client; publisher/build registration still require
separate setup. Expo Go cannot validate the release OTA lifecycle.

## Check your setup

From the server directory, run `npm run doctor -- --app ../my-expo-app`.
Use `--offline` before starting Docker or `--mode remote --server-env ./server.env`
for hosted infrastructure. [Doctor](docs/doctor.md) explains failures without
changing your configuration; `--json` supports CI.

## Documentation

- [Client hook and update modes](docs/ota-client-lifecycle.md)
- [Device targeting](docs/device-targeting.md) and [installation analytics](docs/installation-telemetry.md)
- [Update policy](docs/ota-update-policy.md) and [emergency recovery](docs/ota-emergency-recovery.md)
- [Deployment, backups and operations](docs/operations-guide.md)

## Contributing

From a source checkout, run `npm ci`, then `npm test` and `npm run lint`.
Run `npm run docs:dev` to preview the VitePress documentation.
See [publishing the initializer](https://github.com/tonichiga/expo-updates-server/blob/main/docs/publishing-npm-installer.md)
for the commit, package smoke test and release workflow. A merge alone does not
update the package used by `npx`.

Released under the [MIT License](LICENSE).
