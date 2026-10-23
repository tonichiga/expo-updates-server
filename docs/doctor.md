# Diagnose setup with doctor

Run `doctor` from the **server directory**. It checks the server and optionally an
Expo app without changing files, starting containers, applying migrations, uploading
assets or activating updates. Node.js 24 is recommended; the env parser requires
Node.js 20.12+. Certificate usage checks also need the OpenSSL executable.

```bash
npm ci
npm run doctor -- --app ../my-expo-app
```

The default is **Docker mode**, with `.env` and `docker-compose.yml`. The `app`
service must be running. Database, bucket and signing-key probes execute inside
that container as its normal user, so they test actual container access rather
than the host's permission to read a bind-mounted key.

To check only server files before startup:

```bash
npm run doctor -- --offline --certificate ./local-certificates/code-signing-certificate.pem
```

Offline Docker checks use the standard template's env mapping and host key location
`secrets/code-signing-private-key.pem`. They do not evaluate custom Compose overrides
or prove that the container can read the key.

## Remote or npm deployment

Choose remote mode explicitly. It reads **only** the selected env file, without
merging shell credentials or loading another `.env.local` implicitly:

```bash
npm run doctor -- \
  --mode remote \
  --server-env ./server.env \
  --app ../my-expo-app
```

This mode supports PostgreSQL/S3 and Supabase configurations. Run it where the env
file, private key, database and storage are accessible. Relative private-key paths
resolve from the server directory. No SSH connection or remote filesystem access
is inferred from a hostname. Env variable interpolation is not evaluated in remote
mode; use explicit values. PostgreSQL URLs must include user/password and database;
only `sslmode` is supported in URL query parameters. The default port is explicitly
5432, so ambient `PG*` credentials/ports cannot silently select another connection.

## Custom Docker project

Pass the same project and Compose files used to start the stack, in the same order:

```bash
npm run doctor -- \
  --server-env .env.ota-test \
  --project ota-test \
  --compose-file docker-compose.yml \
  --compose-file docker-compose.ota-test.yml \
  --app ../rn-app-ota-test
```

`--compose-file` is repeatable. These example test files belong to a local test
stand; use your own files for a generated project. Docker connection/context
settings are forwarded, but arbitrary shell application env overrides are not.
The online probe reads the running app's environment and reports a public URL
mismatch with the selected env file.

## What is checked

| Area | Checks |
| --- | --- |
| Runtime | Node env parser and server dependencies |
| Environment | Explicit env file, placeholder values, Docker escaping caveats |
| Signing | Readable RSA key, at least 2048 bits, current non-CA public certificate, Digital Signature / Code Signing usage, matching public keys |
| Server URL | Valid public URL, host access to `/api/health`, loopback/HTTP caveat |
| PostgreSQL | Connection, read access to core OTA/telemetry/targeting columns, required table/function signatures and enabled audience-activation trigger |
| Supabase | Read access to core REST tables/columns and storage bucket; SQL function bodies are not inspected |
| Storage | Existing accessible bucket via S3 HEAD or Supabase bucket GET; no writes |
| Expo app | Static config, installed client dependencies, implementation files, URL/channel/runtime, native check mode, identity namespace and telemetry URL |
| Root | Recognized root hook/gate wiring and generated bootstrap metadata; custom roots need manual verification |
| Publisher/registrar | Presence and basic shape of `.env.ota` credentials, publisher command, channel and registration URL consistency |

Without `--app`, app checks are skipped. Without an app certificate or an explicit
`--certificate`, key-pair comparison is skipped. An explicit certificate takes
precedence over the app's certificate and produces a warning if it is a different
file. Doctor never evaluates `app.config.*`; those projects report the current
static-config limitation.

Each check reports `pass`, `fail`, `warn` or `skip`, plus an actionable remedy where
needed. Raw exceptions, credentials, private keys and connection strings are not
included in the output.

## CI and timeouts

```bash
npm run --silent doctor -- --mode remote --server-env ./server.env --json
```

Use `--silent` so npm's command banner does not precede the JSON document.
Output has a versioned shape:

```json
{
  "version": 1,
  "mode": "remote",
  "offline": false,
  "status": "fail",
  "checks": [
    {
      "id": "signing.key",
      "status": "fail",
      "message": "Signing key is missing, unreadable or invalid.",
      "remedy": "Check the signing key configuration and read permissions."
    }
  ]
}
```

Exit codes: `0` means no detected blockers (warnings/skips may remain), `1` means
failed checks, and `2` means invalid arguments or an unexpected diagnostic failure.
Use `--timeout 10000` to allow 10 seconds per network operation; supported values
are 500–30000 ms. Several probes run sequentially, so the total duration can exceed
one timeout. Docker execution also has an overall bound.

## What a pass does not prove

Doctor does not validate native SDK toolchains, execute builds, compare every
migration definition or exercise write permissions. A token's presence does not
prove its scope. App credentials may differ from server credentials; publisher and
registrar authorization still need the real build/publish flow. Container settings
other than the public URL are checked as currently running, not compared exhaustively
with pending Compose changes.

The host reaching a URL does not prove that a phone can reach it. Source configuration
also cannot prove which URL/runtime/certificate is installed in a native binary.
After fixing configuration, follow the [Quick Start](./getting-started.md) or
[fresh app verification](./expo-app-setup.md#verify-generation-in-a-fresh-application)
for the final build → install → publish → activate → download → restart check.
