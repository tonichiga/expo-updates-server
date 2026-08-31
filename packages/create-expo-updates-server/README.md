# create-expo-updates-server

Create a standalone, self-hosted Expo Updates Server project from the
versioned template bundled in this npm package.

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

To scaffold into an empty current directory instead:

```bash
mkdir my-server
cd my-server
npx create-expo-updates-server@latest .
```

The initializer performs no network requests, dependency installation, Git
initialization, or secret generation while scaffolding. A named target must
remain absent while the command runs. The special `.` target is accepted only
when it resolves to the current directory and that directory starts empty.
The initializer verifies a private sibling staging snapshot before installing
it and never merges with an existing entry. If installation into `.` stops
after creating files, it reports the partial output for manual review rather
than recursively deleting the current directory.

Successful output provides numbered Docker and npm paths. When `.` is used,
those steps start directly with configuration or installation instead of
asking you to change into the directory again.

See the
[installer documentation](https://github.com/tonichiga/expo-updates-server/blob/main/docs/npm-installer.md)
for Docker and npm setup instructions.
