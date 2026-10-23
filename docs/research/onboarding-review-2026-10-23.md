# Onboarding review — 2026-10-23

## Scope and evidence

Reviewed the current worktree against `8c02b5f5974d917cba116627047f97de257d3827`:
public initializer → server bootstrap → Expo configuration → native registration
→ first OTA → targeted activation. Two independent reviews covered documentation
standards and the expected first-time user workflow. No repository AGENTS/CONTEXT
rules were found. This is an implementation review, not a completed clean-machine
or two-platform native acceptance test.

Relevant sources: `packages/create-expo-updates-server/lib/cli.mjs`,
`scripts/lib/expo-app-configurator.mjs`, `scripts/lib/expo-app-prompts.mjs`,
`templates/expo-app/scripts/ota-register-embedded/index.mjs`, `docker-compose.yml`,
`Dockerfile`, `app/api/health/route.ts` and the setup guides.

## Standards review

No explicit repository coding-standard violations identified. The main editorial
problem was multiple competing setup narratives: README repeated the quick start
and retained a large commented legacy guide; automatic setup was followed by manual
steps that looked mandatory. NPX was presented as an alternative to Docker even
though one creates files and the other runs services.

Changes made:

- README is an overview and a route into the complete quick start.
- EN/RU quick starts use configure → credentials → native build/install → JS change
  → publish inactive → choose audience/activate → check/download/restart.
- Commands identify the server directory versus the application directory.
- Manual client integration, generated-root verification and native reference remain
  available without being prerequisites for the normal path.
- Installer output points to the bundled complete guide instead of suggesting that
  unconfigured files are a running server.

## Spec review

### Fixed in this review

| Priority | Defect | Correction |
| --- | --- | --- |
| P1 | Docker-only users had no host `node_modules`; configurator imports TypeScript | Explicit host Node/npm and `npm ci` before configuration |
| P1 | Unconditional copying of `.env.ota.example` replaced generated credentials | Create only if `.env.ota` does not exist |
| P1 | Publication appeared before a release containing new native dependencies | Explicit native build/install and registration before first OTA |
| P2 | Short startup commands omitted required signing keys | One complete startup guide; CLI links it before startup |
| P2 | Local registration appeared to require an unnecessary HTTP token | Document DB registration and HTTP token as alternative paths |
| P2 | Generated default hook has no test UI and only automatic checks | Explain manual controls or explicit automation before testing |
| P2 | Manual hook fallback could imply dynamic-config publishing support | Explicitly separate client integration from publisher/build integration |

### Remaining implementation issues

1. **P1 — unpublished changes are absent from the public initializer.** Registry/package
   review observed `latest=0.1.6`, source commit `8c02b5f…`, without the new client,
   root hook patcher or targeting migration. The template builder reads Git objects,
   not the dirty worktree. Commit the intended snapshot, increment the package
   version, run package smoke checks, then use the release workflow. Do not treat
   `installer:check` on old HEAD as validation of current worktree changes.

2. **P1 — health is only database readiness.** Signing key existence/readability and
   storage readiness are not checked. On Linux, `chmod 600` on a host-owned bind-mounted
   key can prevent container UID 1001 from reading it. Guides now include a private-key
   parse check inside the app container and a group-read remedy; server startup still
   needs an actual preflight. Do not expose secret values in readiness responses.

3. **P2 — env parsing/serialization and URL interpolation disagree.** Configurator's
   homemade parser, unquoted emitted storage values, and Compose interpolation into a
   PostgreSQL URI do not form a reliable round trip for passwords containing `#`, `$`,
   quotes or URL separators. Guides recommend random hex credentials for the current
   Docker path. A real fix must cover Compose, generated `.env.ota`, publisher and
   registrar together, with round-trip tests and no logging of credentials. Merely
   switching one parser is insufficient.

4. **P2 — local credentials are inferred from the public hostname.** Only localhost,
   127.0.0.1 and `*.devtunnels.ms` qualify for automatic local credentials. Explicit
   `--server-env` does not override this decision. LAN/other tunnels therefore require
   manual credentials, and the prompt defaults to localhost, which a phone cannot
   reach. Separate explicit infrastructure choice from device-facing URL. Do not
   silently use a local env file for an arbitrary remote deployment.

5. **P2 — dynamic Expo configuration lacks an end-to-end generated path.** Root/client
   manual integration is supported; the configurator rejects `app.config.*`, while
   publisher reads static `app.json`. Supporting dynamic config needs one resolved
   Expo configuration shared by configuration, publish and native registration, with
   explicit environment/variant selection. This is a separate feature, not a docs fix.

6. **P2 — publishing requires database and storage credentials.** The HTTP access token
   only supports embedded registration today. A publish API could remove DB/S3
   distribution from app projects/CI, but must own authorization, asset upload,
   idempotency, interrupted-upload cleanup and inactive release creation. It should
   not be disguised as a small CLI convenience change.

7. **P3 — packaged docs are Markdown, not the complete VitePress site.** The template
   policy excludes `docs/.vitepress/**`; source-checkout `docs:dev` instructions must
   not imply the standalone generated project includes the same navigation/config.
   Decide whether to ship a supported docs site or retain only bundled Markdown plus
   links to published documentation.

## Proposed tools, in order

### 1. `doctor`: read-only diagnostics

Implemented after this review; see [doctor](../doctor.md) for current behavior and
limits. Uses existing Node tooling and Docker Compose without an additional CLI
framework. Invocation:

```text
npm run doctor -- --server-env .env --app ../mobile
```

Scope: parse and validate explicit config; required runtime/dependencies; public
URL consistency; key/certificate validity and match; container key readability;
database/schema and bucket reachability; app URL/runtime/channel/entry/hook config;
which registration/publishing credentials are present. Separate checks that require
a running server from static checks; support machine-readable output and a nonzero
exit code for blockers. Mask credentials, apply timeouts and make no mutations.
A successful host check cannot prove the phone's network reachability: give an
explicit device verification step instead of claiming it can.

Acceptance: fresh valid setup passes; missing key, mismatched certificate, unreadable
key, missing bucket, inaccessible DB and URL mismatch produce distinct actionable
errors. Existing setup and files remain unchanged. Both Docker and remote deployments
are supported explicitly, not inferred from hostname.

### 2. `setup-local`: compose existing primitives

After shared env handling is corrected, add an idempotent local-only bootstrap:
random credentials, key pair, env files, Docker startup, admin creation and doctor.
Reuse Node `crypto.randomBytes`, the OpenSSL executable and existing administrator
logic. Preserve existing keys/passwords/volumes; detect partial setup and explain
which step can be resumed. Native platform toolchains, a reachable phone URL and
release activation remain explicit steps. Do not add another subtly different env
parser or copy administration logic into a second tool.

### 3. Shared resolved app configuration / publish API

Implement separately once the local happy path is stable. These remove actual
capability gaps; a third documentation page or an extra prompt will not solve them.

## Verification for this change

Run VitePress production build and rendered-link validation for changed entrypoints;
run existing installer CLI tests for plain/colored/current-directory output. The
application's runtime, database, release audience and existing credentials are not
modified by these changes. Full public `npx` and native-device acceptance remain
release checks after the new snapshot is committed and packaged.

Results: VitePress production build passed; 20 installer CLI tests passed; targeted
ESLint passed; configurator `--help` passed; local link/rendered-fragment checks
passed. Independent follow-up review confirmed controls precede native builds,
both registration paths are documented and CLI preserves existing env guidance.

## Doctor implementation verification

Implemented in `scripts/doctor.mjs`, `scripts/lib/doctor.mjs` and
`scripts/lib/doctor-probes.mjs`; included in the initializer template policy along
with `docs/doctor.md`. No new package dependency. A new npm release is still required
for public NPX consumers to receive this worktree change.

Validation: 360 tests across 48 files pass, including 18 doctor cases. Targeted
ESLint and VitePress production build pass. Live read-only execution against the
isolated `ota-test` Compose project and `rn-app-ota-test` app produced 27 passing
checks and one expected warning: source inspection cannot verify the installed
native binary. No configuration, database row, bucket, release or phone was changed.

### Standards

Independent final review: no documented-standard violations or remaining blocking
findings. Nonblocking heuristic: certificate/config checks partly duplicate the
configurator/publisher; a shared validation module may prevent future drift.

### Spec

Independent review findings were fixed and regression-tested: certificate KU/EKU,
missing implementation files, canonical scope, required SQL signatures/activation
trigger, and ambient PostgreSQL settings. Final review found no blockers in those
fixes. Supabase REST cannot inspect SQL trigger/function definitions; this is an
explicit warning, with direct PostgreSQL diagnostics documented as the alternative.

Final findings: Standards — 0 blocking, 1 nonblocking duplication heuristic;
Spec — 0 remaining blocking findings in the reviewed implementation.
