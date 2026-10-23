import { cp, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Check the generated source against the target application's actual Expo/RN types.
const app = process.argv[2];
if (!app)
  throw new Error(
    "Usage: node scripts/tests/ota-client-types.mjs /path/to/expo-app",
  );
const require = createRequire(path.resolve(app, "package.json"));
const temp = await mkdtemp(path.join(os.tmpdir(), "ota-client-types-"));
try {
  const template = fileURLToPath(
    new URL("../../templates/expo-app/ota-client", import.meta.url),
  );
  await cp(template, path.join(temp, "ota-client"), { recursive: true });
  await symlink(
    path.resolve(app, "node_modules"),
    path.join(temp, "node_modules"),
    "dir",
  );
  await writeFile(
    path.join(temp, "ota-client/config.json"),
    JSON.stringify({
      channel: "test",
      identityNamespace: "test",
      heartbeatUrl: "https://example.org/api/device-heartbeat",
    }),
  );
  await writeFile(
    path.join(temp, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        types: ["react", "react-native"],
      },
      include: ["ota-client/**/*"],
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--project",
      path.join(temp, "tsconfig.json"),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("Generated OTA client typecheck failed.");
  console.log(
    "Generated OTA client passed strict TypeScript with the application dependencies.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
