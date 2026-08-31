import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(packageDir, "../..");
const workRoot = path.join(packageDir, ".smoke-work");
const packRoot = path.join(workRoot, "pack");
const consumerRoot = path.join(workRoot, "consumer");
const generatedRoot = path.join(workRoot, "generated project \uD83D\uDE80");
export const maximumPackedSize = 10 * 1024 * 1024;
export const maximumUnpackedSize = 50 * 1024 * 1024;
export const maximumPackedFileSize = 10 * 1024 * 1024;

export function validatePackResult(packResult) {
  if (
    !Number.isSafeInteger(packResult?.size) ||
    packResult.size < 0 ||
    packResult.size > maximumPackedSize
  ) {
    throw new Error(
      `packed size ${packResult?.size} exceeds ${maximumPackedSize}`,
    );
  }
  if (
    !Number.isSafeInteger(packResult.unpackedSize) ||
    packResult.unpackedSize < 0 ||
    packResult.unpackedSize > maximumUnpackedSize
  ) {
    throw new Error(
      `unpacked size ${packResult.unpackedSize} exceeds ${maximumUnpackedSize}`,
    );
  }
  if (!Array.isArray(packResult.files)) {
    throw new Error("npm pack returned no file metadata");
  }
  for (const file of packResult.files) {
    if (
      !Number.isSafeInteger(file?.size) ||
      file.size < 0 ||
      file.size > maximumPackedFileSize
    ) {
      throw new Error(
        `packed file ${file?.path} size ${file?.size} exceeds ${maximumPackedFileSize}`,
      );
    }
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

export async function packSmoke() {
try {
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(packRoot, { recursive: true });
  await mkdir(consumerRoot, { recursive: true });

  const packOutput = run("npm", [
    "pack",
    "--silent",
    "--workspace",
    "create-expo-updates-server",
    "--json",
    "--pack-destination",
    packRoot,
  ]);
  const jsonStart =
    packOutput.lastIndexOf("\n[") >= 0
      ? packOutput.lastIndexOf("\n[") + 1
      : packOutput.indexOf("[");
  assert.ok(jsonStart >= 0, "npm pack returned no JSON metadata");
  const [packResult] = JSON.parse(packOutput.slice(jsonStart));
  assert.ok(packResult, "npm pack returned no package");
  validatePackResult(packResult);

  const packedFiles = packResult.files.map(({ path: file }) => file);
  for (const required of [
    "bin/create-expo-updates-server.mjs",
    "lib/cli.mjs",
    "dist/template-manifest.json",
    "dist/template/gitignore.template",
    "dist/template/package.json",
    "dist/template/package-lock.json",
  ]) {
    assert.ok(packedFiles.includes(required), `tarball is missing ${required}`);
  }
  for (const forbidden of ["scripts/build-template.mjs", "test/cli.test.mjs"]) {
    assert.equal(
      packedFiles.includes(forbidden),
      false,
      `tarball unexpectedly contains ${forbidden}`,
    );
  }
  assert.equal(
    packedFiles.some((file) => file.endsWith(".tgz")),
    false,
    "tarball contains a nested package tarball",
  );

  await writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "installer-smoke-consumer", private: true })}\n`,
  );
  const tarball = path.join(packRoot, packResult.filename);
  run(
    "npm",
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: consumerRoot },
  );

  const installedPackage = path.join(
    consumerRoot,
    "node_modules",
    "create-expo-updates-server",
  );
  run(
    process.execPath,
    [
      path.join(installedPackage, "bin", "create-expo-updates-server.mjs"),
      generatedRoot,
    ],
    { cwd: consumerRoot },
  );

  const generatedPackage = JSON.parse(
    await readFile(path.join(generatedRoot, "package.json"), "utf8"),
  );
  const generatedLock = JSON.parse(
    await readFile(path.join(generatedRoot, "package-lock.json"), "utf8"),
  );
  assert.equal(generatedPackage.name, "expo-updates-server");
  assert.equal(generatedPackage.private, true);
  assert.equal(generatedPackage.workspaces, undefined);
  assert.match(
    await readFile(path.join(generatedRoot, ".gitignore"), "utf8"),
    /node_modules/,
  );
  assert.equal(generatedLock.packages[""].name, "expo-updates-server");
  assert.equal(generatedLock.packages[""].workspaces, undefined);

  run(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: generatedRoot },
  );

  console.log(
    `npm pack smoke test passed (${packResult.size} bytes, ${packedFiles.length} files).`,
  );
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await packSmoke();
}
