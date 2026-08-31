# create-expo-updates-server

Create a standalone, self-hosted Expo Updates Server project from the
versioned template bundled in this npm package.

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

The initializer performs no network requests, dependency installation, Git
initialization, or secret generation while scaffolding. The target path must
remain absent while the command runs; the initializer never merges with an
existing path. If scaffolding fails after staging starts, the error reports the
private staging directory left for manual inspection or removal.

See the
[installer documentation](https://github.com/tonichiga/expo-updates-server/blob/main/docs/npm-installer.md)
for Docker and npm setup instructions.
