# Publishing `create-expo-updates-server`

The root Next.js package stays private. Only the
`packages/create-expo-updates-server` workspace is published.

## One-time npm configuration

Protect the `npm-publish` GitHub environment with required release reviewers
before any publication. Normal releases use npm Trusted Publishing and the
OIDC-only `.github/workflows/publish-create-expo-updates-server.yml`; they do
not use an npm token.

### First publication

First try to configure an npm **Trusted Publisher** for
`tonichiga/expo-updates-server`, workflow
`.github/workflows/publish-create-expo-updates-server.yml`, and environment
`npm-publish`.

If npm requires the package to exist before it can accept that configuration,
an authorized maintainer may make exactly one manual publication:

1. Complete the release validation below, then build one tarball with
   `npm pack --workspace create-expo-updates-server`. Inspect that `.tgz` and
   retain the reviewed file without rebuilding it.
2. From a trusted maintainer machine, authenticate to npm with OTP and run
   `npm publish <reviewed-tarball> --access public`. Do not add
   `--provenance`: this first manual publication will not have GitHub
   provenance.
3. Immediately configure the Trusted Publisher described above.

Never store an npm publication token in GitHub, the repository, a workflow, or
a maintainer file. There is no token-based bootstrap workflow. Every later
publication must use the tag-triggered Trusted Publishing workflow.

## Release procedure

1. Create a branch from current `main`.
2. Bump `version` in
   `packages/create-expo-updates-server/package.json` and run `npm install` so
   the root lockfile records the exact same workspace version.
3. Run:

   ```bash
   npm ci
   npm run installer:check
   npm run installer:pack-smoke
   npm run docs:build
   ```

4. Open a pull request and merge it only after CI and review pass.
5. On the merged commit, create and push exactly:

   ```text
   create-expo-updates-server-v<version>
   ```

   For example, package version `0.2.0` requires
   `create-expo-updates-server-v0.2.0`.

The tag-only workflow validates the tag against the package version, rebuilds
and tests the deterministic template, and verifies that the tagged commit is
an ancestor of `origin/main`. This validation runs before the protected
`npm-publish` environment is entered. It creates one release tarball, passes
that exact artifact to the environment-gated publish job, and publishes with
public access and npm provenance through OIDC. A tag mismatch, an unmerged
commit, or a checkout/event SHA mismatch cannot publish.

The publish job has only `contents: read` and `id-token: write`; npm access is
provided by Trusted Publishing. Do not broaden its permissions or move build
steps into the environment-gated job.

Never move, delete, or reuse a release tag. If publication fails after a
version is visible on npm, bump to a new version through another pull request.
Create a GitHub Release separately if desired; npm publication does not need
repository write permission.
