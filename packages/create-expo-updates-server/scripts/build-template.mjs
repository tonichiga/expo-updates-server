import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(packageDir, "../..");
export const maximumTemplateFileSize = 10 * 1024 * 1024;
export const maximumTemplateSize = 50 * 1024 * 1024;
export const maximumManifestSize = 5 * 1024 * 1024;

function fail(message) {
  throw new Error(`Template build failed: ${message}`);
}

function isPolicyMatch(file, rule) {
  if (rule.endsWith("/**")) {
    const directory = rule.slice(0, -3);
    return file === directory || file.startsWith(`${directory}/`);
  }
  return file === rule;
}

function validateRelativePath(file) {
  if (
    typeof file !== "string" ||
    file.length === 0 ||
    file.includes("\0") ||
    file.includes("\\") ||
    path.posix.isAbsolute(file)
  ) {
    fail(`unsafe path: ${JSON.stringify(file)}`);
  }

  const normalized = path.posix.normalize(file);
  if (
    normalized !== file ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    file.split("/").includes("..")
  ) {
    fail(`path traversal: ${JSON.stringify(file)}`);
  }
}

function canonicalPath(file) {
  return file.normalize("NFKC").toLowerCase();
}

function assertNoCaseCollisions(files) {
  const seen = new Map();
  for (const file of files) {
    const segments = file.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const partial = segments.slice(0, index).join("/");
      const canonical = canonicalPath(partial);
      const previous = seen.get(canonical);
      if (previous && previous !== partial) {
        fail(`case-colliding paths: ${previous} and ${partial}`);
      }
      seen.set(canonical, partial);
    }
  }
}

function assertNotSecretPath(file) {
  const lower = file.toLowerCase();
  const basename = path.posix.basename(lower);
  const envExample =
    basename.startsWith(".env") && basename.endsWith(".example");

  if (
    (basename.startsWith(".env") && !envExample) ||
    basename === ".npmrc" ||
    basename === "npmrc" ||
    /(?:^id_(?:rsa|dsa|ecdsa|ed25519)$|private[-_.]?key)/i.test(basename) ||
    /\.(?:pem|key|p12|pfx|crt|cer|cert|der|jks|keystore|tgz)$/i.test(
      basename,
    ) ||
    lower.split("/").includes("secrets") ||
    lower.split("/").includes("local-certificates")
  ) {
    fail(`secret or package artifact path is forbidden: ${file}`);
  }
}

function isClearlyPlaceholder(value) {
  let normalized = value.trim().replace(/,\s*$/, "").trim();
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  const placeholders = new Set([
    "",
    "...",
    "ota_...",
    "<secret-access-key>",
    "<service-role-key>",
    "******host:5432/database",
    "******localhost:YOUR_POSTGRES_PORT/expo_updates",
    "postgresql://user:password@host:5432/database",
    "postgresql://USER:PASSWORD@HOST:5432/DATABASE",
    "postgresql://expo_updates:YOUR_POSTGRES_PASSWORD@localhost:YOUR_POSTGRES_PORT/expo_updates",
    "replace-with-a-strong-storage-password",
    "choose-a-long-random-password",
    "choose-another-long-random-password",
    "YOUR_MINIO_ROOT_PASSWORD",
    "YOUR_SERVICE_ROLE_KEY",
    "ваш-надежный-пароль-базы",
    "ваш-надежный-пароль-хранилища",
    "ВАШ_MINIO_ROOT_PASSWORD",
    "ВАШ_SERVICE_ROLE_KEY",
    "postgresql://...",
    "postgresql://expo_updates:ВАШ_POSTGRES_PASSWORD@localhost:ВАШ_POSTGRES_PORT/expo_updates",
    "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
    "${POSTGRES_PASSWORD:-expo_updates_local}",
    "${MINIO_ROOT_PASSWORD:-expo_updates_local}",
    "${CODE_SIGNING_PRIVATE_KEY:-}",
    "postgresql://${POSTGRES_USER:-expo_updates}:${POSTGRES_PASSWORD:-expo_updates_local}@postgres:5432/${POSTGRES_DB:-expo_updates}",
  ]);
  return placeholders.has(normalized);
}

function sensitiveName(name) {
  return /^(?:(?:[A-Z][A-Z0-9_]*_)?DATABASE_URL|POSTGRES_PASSWORD|R2_SECRET_ACCESS_KEY|SUPABASE_SERVICE_ROLE_KEY|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PRIVATE_KEY|PASSWORD))$/.test(
    name,
  );
}

export function assertNoSecretContent(file, content) {
  const text = content.toString("utf8");
  const secretPatterns = [
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?[A-Za-z0-9+/]{40,}={0,2}[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
    /(?:^|\n)\s*\/\/[^\s]+\/?:_authToken\s*=/i,
    /\bnpm_[A-Za-z0-9]{36,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    fail(`probable secret content found in ${file}`);
  }

  const assignmentPatterns = [
    /(?:^|\n)\s*(?:export\s+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^\r\n]*)/g,
    /(?:^|\n)\s*["']?([A-Z][A-Z0-9_]*)["']?[ \t]*:[ \t]*([^\r\n]*)/g,
  ];
  for (const pattern of assignmentPatterns) {
    for (const match of text.matchAll(pattern)) {
      const [, name, value] = match;
      if (sensitiveName(name) && !isClearlyPlaceholder(value)) {
        fail(`populated sensitive value ${name} found in ${file}`);
      }
    }
  }
}

function resolveSourceCommit(root) {
  const sourceCommit = execFileSync(
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    fail(`invalid source commit: ${sourceCommit}`);
  }
  return sourceCommit;
}

function trackedFiles(root, sourceCommit) {
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--full-tree", sourceCommit],
    { cwd: root, encoding: "utf8" },
  );

  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d+) ([a-z]+) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
      if (!match) fail(`could not parse Git tree entry: ${entry}`);
      if (match[2] !== "blob") {
        fail(`unsupported Git object type ${match[2]}: ${match[4]}`);
      }
      return { mode: match[1], object: match[3], path: match[4] };
    });
}

function readGitObject(root, object) {
  return execFileSync("git", ["cat-file", "blob", object], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
  });
}

function repositoryPath(root, location) {
  const relative = path.relative(root, location);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail(`installer package is outside the repository: ${location}`);
  }
  return relative.split(path.sep).join("/");
}

function readCommittedJson(root, entries, file) {
  const entry = entries.find(({ path: entryPath }) => entryPath === file);
  if (!entry) fail(`source commit has no ${file}`);
  try {
    return JSON.parse(readGitObject(root, entry.object).toString("utf8"));
  } catch (error) {
    fail(`could not parse ${file}: ${error.message}`);
  }
}

export function validateTemplateSizes(files) {
  let totalSize = 0;
  for (const entry of files) {
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > maximumTemplateFileSize
    ) {
      fail(`file exceeds the ${maximumTemplateFileSize} byte limit: ${entry.path}`);
    }
    totalSize += entry.size;
    if (
      !Number.isSafeInteger(totalSize) ||
      totalSize > maximumTemplateSize
    ) {
      fail(`template exceeds the ${maximumTemplateSize} byte total limit`);
    }
  }
  return totalSize;
}

export function serializeManifest(manifest) {
  const content = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (content.byteLength > maximumManifestSize) {
    fail(`manifest exceeds the ${maximumManifestSize} byte limit`);
  }
  return content;
}

function standalonePackage(source) {
  const result = structuredClone(source);
  result.name = "expo-updates-server";
  delete result.workspaces;
  result.scripts = Object.fromEntries(
    Object.entries(result.scripts ?? {}).filter(
      ([name]) => !name.startsWith("installer:"),
    ),
  );
  return result;
}

function standaloneLock(source, generatedPackage) {
  const result = structuredClone(source);
  result.name = generatedPackage.name;
  result.version = generatedPackage.version;

  const root = result.packages?.[""];
  if (!root) fail("package-lock.json has no root package entry");
  root.name = generatedPackage.name;
  root.version = generatedPackage.version;
  delete root.workspaces;

  for (const [key, value] of Object.entries(result.packages)) {
    if (
      key === "packages/create-expo-updates-server" ||
      key === "node_modules/create-expo-updates-server" ||
      (value?.link &&
        value.resolved === "packages/create-expo-updates-server")
    ) {
      delete result.packages[key];
    }
  }

  return result;
}

function materializedContent(root, entry, generatedPackage) {
  const source = readGitObject(root, entry.object);
  const file = entry.path;
  if (file === "package.json") {
    return Buffer.from(`${JSON.stringify(generatedPackage, null, 2)}\n`);
  }
  if (file === "package-lock.json") {
    const parsed = JSON.parse(source.toString("utf8"));
    return Buffer.from(
      `${JSON.stringify(standaloneLock(parsed, generatedPackage), null, 2)}\n`,
    );
  }
  return source;
}

export async function buildTemplate(options = {}) {
  const root = options.repositoryRoot ?? repositoryRoot;
  const installerRoot = options.packageDir ?? packageDir;
  const finalDist = options.finalDist ?? path.join(installerRoot, "dist");
  const sourceCommit = resolveSourceCommit(root);
  const allTracked = trackedFiles(root, sourceCommit);
  const installerPath = repositoryPath(root, installerRoot);
  const policy = readCommittedJson(
    root,
    allTracked,
    `${installerPath}/template-policy.json`,
  );
  if (
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.include) ||
    !Array.isArray(policy.deny)
  ) {
    fail("template-policy.json has an unsupported schema");
  }

  const selected = allTracked
    .filter(({ path: file }) =>
      policy.include.some((rule) => isPolicyMatch(file, rule)),
    )
    .filter(({ path: file }) => {
      if (policy.deny.some((rule) => isPolicyMatch(file, rule))) {
        fail(`allowlisted path is also denied: ${file}`);
      }
      return true;
    })
    .sort((left, right) => left.path.localeCompare(right.path, "en"));

  if (selected.length === 0) fail("policy selected no files");

  for (const { mode, path: file } of selected) {
    validateRelativePath(file);
    assertNotSecretPath(file);
    if (mode === "120000") fail(`symlinks are forbidden: ${file}`);
    if (mode !== "100644" && mode !== "100755") {
      fail(`unsupported git mode ${mode}: ${file}`);
    }
  }
  assertNoCaseCollisions(selected.map(({ path: file }) => file));

  const installerPackage = readCommittedJson(
    root,
    allTracked,
    `${installerPath}/package.json`,
  );
  const rootPackage = readCommittedJson(root, allTracked, "package.json");
  const generatedPackage = standalonePackage(rootPackage);

  const stagingDist = path.join(
    installerRoot,
    `.dist-building-${randomUUID()}`,
  );
  const templateRoot = path.join(stagingDist, "template");
  const files = [];
  let totalSize = 0;

  try {
    await mkdir(templateRoot, { recursive: true });
    for (const entry of selected) {
      const content = materializedContent(root, entry, generatedPackage);
      assertNoSecretContent(entry.path, content);
      const bundledPath =
        entry.path === ".gitignore" ? "gitignore.template" : entry.path;
      const destination = path.join(
        templateRoot,
        ...bundledPath.split("/"),
      );
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, {
        mode: entry.mode === "100755" ? 0o755 : 0o644,
      });
      if (entry.mode === "100755") await chmod(destination, 0o755);
      const manifestEntry = {
        path: entry.path,
        size: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
      totalSize = validateTemplateSizes([...files, manifestEntry]);
      if (bundledPath !== entry.path) {
        manifestEntry.bundledPath = bundledPath;
      }
      files.push(manifestEntry);
    }

    const manifest = {
      schemaVersion: 1,
      installerVersion: installerPackage.version,
      sourceCommit,
      totalSize,
      files,
    };
    await writeFile(
      path.join(stagingDist, "template-manifest.json"),
      serializeManifest(manifest),
      { mode: 0o644 },
    );

    await rm(finalDist, { recursive: true, force: true });
    await rename(stagingDist, finalDist);
  } catch (error) {
    await rm(stagingDist, { recursive: true, force: true });
    throw error;
  }

  console.log(
    `Built deterministic template with ${files.length} files from ${sourceCommit.slice(0, 7)}.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildTemplate();
}
