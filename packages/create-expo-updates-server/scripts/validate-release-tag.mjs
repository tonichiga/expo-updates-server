import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  await readFile(path.join(packageDir, "package.json"), "utf8"),
);
const tag = process.argv[2];
const expected = `create-expo-updates-server-v${packageJson.version}`;

if (tag !== expected) {
  console.error(`Release tag must exactly match package version: ${expected}`);
  process.exitCode = 1;
} else if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
  console.error("Only stable semantic versions can be published");
  process.exitCode = 1;
} else {
  console.log(`Validated ${tag} for ${packageJson.name}@${packageJson.version}`);
}
