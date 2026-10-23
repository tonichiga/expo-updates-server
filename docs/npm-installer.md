# Create a server with NPX

The npm initializer is the quickest way to create a standalone copy of Expo
Updates Server. Node.js 20.9 or newer is required.

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

You can also initialize an empty current directory:

```bash
mkdir my-server
cd my-server
npx create-expo-updates-server@latest .
```

`npx` downloads the published initializer package from npm. After it starts,
the initializer makes no network requests: the server template and its
SHA-256 manifest are bundled in the package.

For a named target, successful plain-text output looks like this (interactive
terminals add color):

```text
✓ Expo Updates Server project files created
Project: /path/to/my-server

Next steps (Docker):
  1. cd -- 'my-server'
  2. npm ci
  3. Follow docs/getting-started.md: prepare settings and signing keys before starting Docker.

Next steps (npm):
  1. cd -- 'my-server'
  2. npm ci
  3. Follow docs/operations-guide.md: configure database, storage and signing keys before startup.
```

With `.`, the redundant `cd` step is omitted. Color is disabled when output is
not a TTY or the `NO_COLOR` environment variable is present.

## Safety behavior

The initializer:

- accepts exactly one destination directory;
- requires a named destination path not to exist and refuses existing empty
  or non-empty directories, files, and symbolic links;
- accepts an existing destination only when it resolves exactly to the current
  directory and that directory has no visible or hidden entries;
- creates a unique sibling staging directory with mode `0700`;
- builds the complete project in staging and verifies its full path set, file
  types, sizes, and SHA-256 digests before installation;
- installs an absent named destination with the existing staging-directory
  rename flow;
- checks the current directory's device, inode, and emptiness again immediately
  before installing `.`, creates directories exclusively, copies files with
  no-clobber semantics, and verifies the final full path set, sizes, and
  SHA-256 digests;
- never overwrites an entry encountered while installing `.` and never
  recursively deletes the current directory;
- once staging has started, leaves the unique staging directory in place after
  a failure and reports its exact path for manual inspection or removal; if `.`
  contains partial installer output, that is also reported for manual review.

An absent named destination must remain absent for the entire command. If
another process creates a file, symbolic link, or non-empty directory before
the final rename, the initializer fails and leaves it unchanged. Portable
filesystem APIs do not provide a cross-platform, atomic no-clobber directory
rename. In the narrow race where another process creates an empty named
destination directory after the last absence check, the rename may replace
that empty directory.

Installing into `.` necessarily transfers entries rather than replacing the
current directory itself. Exclusive operations prevent the initializer from
overwriting an entry that appears at a destination path during normal
concurrent use. If installation fails after creating some entries, those
entries are deliberately not removed because they can no longer be safely
distinguished from user changes. Review the reported current directory and
staging snapshot manually. These checks are safety measures for normal
filesystem races, not a security boundary against another process running as
the same user.

Staging contains only public template files. On success, it is consumed by the
named-target rename or removed after the verified `.` transfer, so no staging
directory remains.

It deliberately does not install dependencies, initialize a Git repository,
write `.env` files, or generate signing keys and other secrets. There is no
`--force` option.

## Start the generated project

Follow the bundled [Quick Start](./getting-started.md) in order: environment,
signing keys, Docker startup, administrator, reachable phone URL, app configuration,
native build and first OTA. Node/npm and `npm ci` are needed on the host for
`configure-app`, even if the server runs in Docker.

For hosted infrastructure use [Supabase setup](./supabase-setup.md) and the
[operations guide](./operations-guide.md). Configure the database, storage and
signing key before starting the server with npm.

The package contains the template at its recorded source commit. An unpublished
feature in a checkout is not available through `npx ...@latest`; maintainers should
follow the [release workflow](https://github.com/tonichiga/expo-updates-server/blob/main/docs/publishing-npm-installer.md).

## Reproducibility and source

Each published package contains a filtered snapshot whose bytes are read
directly from the Git objects at the recorded source commit in
[tonichiga/expo-updates-server](https://github.com/tonichiga/expo-updates-server).
Dirty or untracked working-tree content cannot affect that snapshot. The
package records the exact source commit and file size and SHA-256 digest for
every generated file. Build output, credentials, populated sensitive values,
real environment files, internal planning documents, and the initializer
itself are excluded.
