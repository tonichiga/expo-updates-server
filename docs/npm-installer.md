# Create a server with NPX

The npm initializer is the quickest way to create a standalone copy of Expo
Updates Server. Node.js 20.9 or newer is required.

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

`npx` downloads the published initializer package from npm. After it starts,
the initializer makes no network requests: the server template and its
SHA-256 manifest are bundled in the package.

## Safety behavior

The initializer:

- accepts exactly one destination directory;
- requires the destination path not to exist and refuses existing empty or
  non-empty directories, files, and symbolic links;
- creates a unique sibling staging directory with mode `0700`;
- builds the complete project in staging and verifies its full path set, file
  types, sizes, and SHA-256 digests before installation;
- checks the destination again immediately before one final rename, so normal
  installation exposes either the complete verified project or no project;
- never merges files, incrementally copies into the destination, or
  recursively deletes the destination;
- leaves the unique staging directory in place after any failure and reports
  its exact path for manual inspection or removal.

The destination must remain absent for the entire command. If another process
creates a file, symbolic link, or non-empty directory before the final rename,
the initializer fails and leaves it unchanged. Portable filesystem APIs do not
provide a cross-platform, atomic no-clobber directory rename. In the narrow
race where another process creates an empty destination directory after the
last absence check, the rename may replace that empty directory.

Staging contains only public template files. On success, the final rename
consumes it, so no staging directory remains.

It deliberately does not install dependencies, initialize a Git repository,
write `.env` files, or generate signing keys and other secrets. There is no
`--force` option.

## Start with Docker

Review the example first, choose strong passwords, and then start the stack:

```bash
cp .env.docker.example .env
docker compose up -d --build
docker compose exec app npm run create-admin
```

Follow the [quick start](/getting-started) to generate the required signing
key pair and connect an Expo application.

## Start with npm

Install exactly the dependencies in the bundled lockfile:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Configure PostgreSQL and S3-compatible storage (or Supabase), signing keys,
and all required environment values before using the server in production.
See [Supabase setup](/supabase-setup), [Expo application
setup](/expo-app-setup), and the [operations guide](/operations-guide).

## Reproducibility and source

Each published package contains a filtered snapshot whose bytes are read
directly from the Git objects at the recorded source commit in
[tonichiga/expo-updates-server](https://github.com/tonichiga/expo-updates-server).
Dirty or untracked working-tree content cannot affect that snapshot. The
package records the exact source commit and file size and SHA-256 digest for
every generated file. Build output, credentials, populated sensitive values,
real environment files, internal planning documents, and the initializer
itself are excluded.
