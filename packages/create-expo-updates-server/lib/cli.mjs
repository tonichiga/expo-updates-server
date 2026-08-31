import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultPackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const command = "create-expo-updates-server";
const maximumTemplateFileSize = 10 * 1024 * 1024;
const maximumTemplateSize = 50 * 1024 * 1024;
const maximumManifestSize = 5 * 1024 * 1024;

const help = `Create a standalone Expo Updates Server project.

Usage:
  ${command} <directory>
  ${command} --help
  ${command} --version

Options:
  -h, --help       Show this help
  -v, --version    Show the package version

The target path must not already exist.
`;

function cliError(message) {
  const error = new Error(message);
  error.isCliError = true;
  return error;
}

function validateManifestPath(file) {
  if (
    typeof file !== "string" ||
    file.length === 0 ||
    file.includes("\0") ||
    file.includes("\\") ||
    path.posix.isAbsolute(file) ||
    path.posix.normalize(file) !== file ||
    file === ".." ||
    file.startsWith("../") ||
    file.split("/").includes("..")
  ) {
    throw cliError(`The bundled template contains an unsafe path: ${file}`);
  }
}

function canonicalPath(file) {
  return file.normalize("NFKC").toLowerCase();
}

async function listTree(root, relative = "") {
  const directory = path.join(root, ...relative.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    validateManifestPath(child);
    if (entry.isSymbolicLink()) {
      throw cliError(`The bundled template contains a symlink: ${child}`);
    }
    if (entry.isDirectory()) {
      result.push({ path: child, type: "directory" });
      result.push(...(await listTree(root, child)));
    } else if (entry.isFile()) {
      result.push({ path: child, type: "file" });
    } else {
      throw cliError(`The bundled template contains a non-file: ${child}`);
    }
  }
  return result;
}

export async function verifyTemplate(packageRoot = defaultPackageRoot) {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  const manifestPath = path.join(
    packageRoot,
    "dist",
    "template-manifest.json",
  );
  const manifestHandle = await open(
    manifestPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let manifestBytes;
  try {
    const manifestStat = await manifestHandle.stat();
    if (
      !manifestStat.isFile() ||
      manifestStat.size > maximumManifestSize
    ) {
      throw cliError("The bundled template manifest is too large");
    }
    manifestBytes = await manifestHandle.readFile();
  } finally {
    await manifestHandle.close();
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const templateRoot = path.join(packageRoot, "dist", "template");

  if (
    manifest.schemaVersion !== 1 ||
    manifest.installerVersion !== packageJson.version ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
    !Number.isSafeInteger(manifest.totalSize) ||
    manifest.totalSize < 0 ||
    manifest.totalSize > maximumTemplateSize ||
    !Array.isArray(manifest.files)
  ) {
    throw cliError("The bundled template manifest is invalid");
  }

  const actualFiles = (await listTree(templateRoot))
    .filter(({ type }) => type === "file")
    .map(({ path: file }) => file)
    .sort((a, b) => a.localeCompare(b, "en"));
  const manifestFiles = [];
  const canonical = new Map();
  let previous = "";
  let totalSize = 0;

  for (const entry of manifest.files) {
    validateManifestPath(entry?.path);
    if (entry.bundledPath !== undefined) {
      validateManifestPath(entry.bundledPath);
    }
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > maximumTemplateFileSize ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      throw cliError(`Invalid manifest entry for ${entry.path}`);
    }
    if (previous && previous.localeCompare(entry.path, "en") >= 0) {
      throw cliError("The bundled template manifest is not sorted");
    }
    previous = entry.path;
    totalSize += entry.size;
    if (
      !Number.isSafeInteger(totalSize) ||
      totalSize > maximumTemplateSize
    ) {
      throw cliError("The bundled template exceeds its total size limit");
    }

    const segments = entry.path.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const partial = segments.slice(0, index).join("/");
      const key = canonicalPath(partial);
      const collision = canonical.get(key);
      if (collision && collision !== partial) {
        throw cliError(
          `The bundled template has case-colliding paths: ${collision} and ${partial}`,
        );
      }
      canonical.set(key, partial);
    }

    const bundledPath = entry.bundledPath ?? entry.path;
    const source = path.join(templateRoot, ...bundledPath.split("/"));
    const handle = await open(
      source,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const sourceStat = await handle.stat();
      if (!sourceStat.isFile()) {
        throw cliError(
          `Bundled template entry is not a regular file: ${entry.path}`,
        );
      }
      if (sourceStat.size !== entry.size) {
        throw cliError(`Bundled template size mismatch: ${entry.path}`);
      }
      const content = await handle.readFile();
      const digest = createHash("sha256").update(content).digest("hex");
      const sourcePathStat = await lstat(source);
      if (
        sourcePathStat.dev !== sourceStat.dev ||
        sourcePathStat.ino !== sourceStat.ino ||
        content.byteLength !== entry.size ||
        digest !== entry.sha256
      ) {
        throw cliError(`Bundled template checksum mismatch: ${entry.path}`);
      }
    } finally {
      await handle.close();
    }
    manifestFiles.push(bundledPath);
  }

  if (totalSize !== manifest.totalSize) {
    throw cliError("The bundled template total size is invalid");
  }

  manifestFiles.sort((a, b) => a.localeCompare(b, "en"));
  if (
    actualFiles.length !== manifestFiles.length ||
    actualFiles.some((file, index) => file !== manifestFiles[index])
  ) {
    throw cliError("Bundled template files do not match the manifest");
  }

  return { manifest, templateRoot };
}

async function copyToStage(templateRoot, manifest, staging) {
  const directories = new Set();
  for (const entry of manifest.files) {
    const file = entry.path;
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }

  for (const directory of [...directories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || left.localeCompare(right, "en");
  })) {
    const destination = path.join(staging, ...directory.split("/"));
    await mkdir(destination);
  }

  for (const entry of manifest.files) {
    const file = entry.path;
    const source = path.join(
      templateRoot,
      ...(entry.bundledPath ?? file).split("/"),
    );
    const destination = path.join(staging, ...file.split("/"));
    await copyFile(source, destination);
    const sourceStat = await lstat(source);
    await chmod(destination, sourceStat.mode & 0o777);
  }
}

async function assertTargetAbsent(target) {
  try {
    await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw cliError(`Target path already exists: ${target}`);
}

function expectedDirectories(manifest) {
  return new Set(
    manifest.files.flatMap(({ path: file }) => {
      const segments = file.split("/");
      return segments
        .slice(0, -1)
        .map((_, index) => segments.slice(0, index + 1).join("/"));
    }),
  );
}

export async function verifyStagedProject(target, manifest) {
  const expectedFiles = new Map(
    manifest.files.map((entry) => [entry.path, entry]),
  );
  const directories = expectedDirectories(manifest);
  const assertPathSet = (actual) => {
    const expectedCount = expectedFiles.size + directories.size;
    if (actual.length !== expectedCount) {
      throw cliError("Generated project paths do not match the manifest");
    }
    for (const entry of actual) {
      if (
        (entry.type === "directory" && !directories.has(entry.path)) ||
        (entry.type === "file" && !expectedFiles.has(entry.path))
      ) {
        throw cliError(`Unexpected generated project path: ${entry.path}`);
      }
    }
  };

  const actual = await listTree(target);
  assertPathSet(actual);

  for (const entry of actual) {
    if (entry.type === "directory") {
      continue;
    }

    const expected = expectedFiles.get(entry.path);
    const location = path.join(target, ...entry.path.split("/"));
    const handle = await open(
      location,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile()) {
        throw cliError(`Generated project entry is not a file: ${entry.path}`);
      }
      if (
        before.size !== expected.size ||
        before.size > maximumTemplateFileSize
      ) {
        throw cliError(`Generated project size mismatch: ${entry.path}`);
      }
      const content = await handle.readFile();
      const after = await handle.stat();
      const pathname = await lstat(location);
      const digest = createHash("sha256").update(content).digest("hex");
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        pathname.dev !== after.dev ||
        pathname.ino !== after.ino ||
        !pathname.isFile() ||
        pathname.isSymbolicLink() ||
        content.byteLength !== expected.size ||
        digest !== expected.sha256
      ) {
        throw cliError(`Generated project checksum mismatch: ${entry.path}`);
      }
    } finally {
      await handle.close();
    }
  }

  assertPathSet(await listTree(target));
}

function sameIdentity(actual, expected) {
  return (
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.isDirectory() &&
    !actual.isSymbolicLink()
  );
}

async function assertOwnedStaging(staging, expected) {
  let actual;
  try {
    actual = await lstat(staging);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw cliError(`Staging directory disappeared: ${staging}`);
    }
    throw error;
  }
  if (!sameIdentity(actual, expected)) {
    throw cliError(`Staging directory was replaced: ${staging}`);
  }
}

export async function installStagedProject({
  staging,
  target,
  manifest,
  stagingIdentity,
  renameProject = rename,
}) {
  await assertOwnedStaging(staging, stagingIdentity);
  await verifyStagedProject(staging, manifest);
  await assertOwnedStaging(staging, stagingIdentity);
  await assertTargetAbsent(target);

  try {
    await renameProject(staging, target);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw cliError(
        `Target path appeared before installation completed: ${target}`,
      );
    }
    if (error?.code === "ENOTEMPTY") {
      throw cliError(
        `Target path became an existing non-empty directory before installation completed: ${target}`,
      );
    }
    if (error?.code === "ENOTDIR" || error?.code === "EISDIR") {
      throw cliError(
        `Target path became an incompatible file or symbolic link before installation completed: ${target}`,
      );
    }
    throw error;
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function scaffold(targetArgument, options = {}) {
  const packageRoot = options.packageRoot ?? defaultPackageRoot;
  const { manifest, templateRoot } = await verifyTemplate(packageRoot);
  const target = path.resolve(options.cwd ?? process.cwd(), targetArgument);
  await assertTargetAbsent(target);
  const parent = path.dirname(target);
  const parentStat = await lstat(parent).catch((error) => {
    if (error?.code === "ENOENT") {
      throw cliError(`Target parent directory does not exist: ${parent}`);
    }
    throw error;
  });
  if (!parentStat.isDirectory()) {
    throw cliError(`Target parent is not a directory: ${parent}`);
  }

  const staging = path.join(
    parent,
    `.create-expo-updates-server-${randomUUID()}`,
  );
  let stagingIdentity;
  let stagingCreated = false;

  try {
    await mkdir(staging, { mode: 0o700 });
    stagingCreated = true;
    stagingIdentity = await lstat(staging);
    if (
      !stagingIdentity.isDirectory() ||
      stagingIdentity.isSymbolicLink()
    ) {
      throw cliError(`Could not create a private staging directory: ${staging}`);
    }
    await chmod(staging, 0o700);
    const privateStaging = await lstat(staging);
    if (
      !sameIdentity(privateStaging, stagingIdentity) ||
      (privateStaging.mode & 0o777) !== 0o700
    ) {
      throw cliError(`Could not create a private staging directory: ${staging}`);
    }
    await copyToStage(templateRoot, manifest, staging);
    if (options.beforeInstall) {
      await options.beforeInstall({ staging, target });
    }
    await installStagedProject({
      staging,
      target,
      manifest,
      stagingIdentity,
    });
  } catch (error) {
    if (stagingCreated) {
      throw cliError(
        `${error.message}
Staging directory retained at: ${staging}
Inspect or remove it manually.`,
      );
    }
    throw error;
  }

  return {
    target,
    nextSteps: `Created Expo Updates Server in ${target}

Next steps (Docker):
  cd -- ${shellQuote(targetArgument)}
  cp .env.docker.example .env
  docker compose up -d --build

Next steps (npm):
  cd -- ${shellQuote(targetArgument)}
  npm ci
  cp .env.example .env.local
  npm run dev`,
  };
}

function parseArguments(args) {
  const options = args.filter((argument) => argument.startsWith("-"));
  const positionals = args.filter((argument) => !argument.startsWith("-"));
  for (const option of options) {
    if (!["--help", "-h", "--version", "-v"].includes(option)) {
      throw cliError(`Unknown option: ${option}`);
    }
  }

  if (options.length > 0) {
    if (args.length !== 1) {
      throw cliError("Help and version options must be used on their own");
    }
    return {
      action: options[0] === "--help" || options[0] === "-h" ? "help" : "version",
    };
  }
  if (positionals.length !== 1) {
    throw cliError(
      positionals.length === 0
        ? "Exactly one target directory is required"
        : "Only one target directory is allowed",
    );
  }
  return { action: "scaffold", target: positionals[0] };
}

function supportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 20 || (major === 20 && minor >= 9);
}

export async function main(args, io = console, options = {}) {
  try {
    if (!supportedNode()) {
      throw cliError(`${command} requires Node.js 20.9 or newer`);
    }
    const parsed = parseArguments(args);
    if (parsed.action === "help") {
      io.log(help.trimEnd());
      return 0;
    }

    const packageRoot = options.packageRoot ?? defaultPackageRoot;
    if (parsed.action === "version") {
      const packageJson = JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
      );
      io.log(packageJson.version);
      return 0;
    }

    const result = await scaffold(parsed.target, {
      ...options,
      packageRoot,
    });
    io.log(result.nextSteps);
    return 0;
  } catch (error) {
    io.error(`Error: ${error.message}`);
    io.error(`Run "${command} --help" for usage.`);
    return 1;
  }
}
