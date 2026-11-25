import { cp, mkdir, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the SDK as an installed package against the target app's Expo/RN types.
const app = process.argv[2];
if (!app)
  throw new Error(
    "Usage: node packages/ota-client/scripts/check-types.mjs /path/to/expo-app",
  );
const require = createRequire(path.resolve(app, "package.json"));
const temp = await mkdtemp(path.join(os.tmpdir(), "ota-client-types-"));
try {
  const sdk = fileURLToPath(new URL("../", import.meta.url));
  const consumer = path.join(temp, "app");
  const installed = path.join(
    consumer,
    "node_modules/expo-updates-server-client",
  );
  await mkdir(installed, { recursive: true });
  await cp(path.join(sdk, "src"), path.join(installed, "src"), {
    recursive: true,
  });
  await cp(
    path.join(sdk, "package.json"),
    path.join(installed, "package.json"),
  );
  await symlink(
    path.resolve(app, "node_modules"),
    path.join(temp, "node_modules"),
    "dir",
  );
  await writeFile(
    path.join(consumer, "index.tsx"),
    `
import { OtaUpdates, initializeOtaClient, start, useOtaUpdates, type OtaClientConfig } from "expo-updates-server-client";
export * as runtime from "expo-updates-server-client/runtime";
export * as types from "expo-updates-server-client/types";
export * as installation from "expo-updates-server-client/controller";
export * as identity from "expo-updates-server-client/device-identity";
export * as lifecycle from "expo-updates-server-client/model/update-controller";
export * as hook from "expo-updates-server-client/model/hooks/useOtaUpdates";
export * as ui from "expo-updates-server-client/ui/ota-updates";
export * as gate from "expo-updates-server-client/ui/ota-update-gate";

const config: OtaClientConfig = { channel: "test", identityNamespace: "test", heartbeatUrl: "https://example.org/api/device-heartbeat" };
initializeOtaClient(config);
start();
export function Root() {
  useOtaUpdates();
  return <OtaUpdates />;
}
`,
  );
  await writeFile(
    path.join(consumer, "tsconfig.json"),
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
        types: ["react", "react-native"],
      },
      include: ["index.tsx"],
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--project",
      path.join(consumer, "tsconfig.json"),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("OTA SDK typecheck failed.");
  console.log(
    "OTA SDK passed strict TypeScript with the application dependencies.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
