import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import {
  installStagedProject,
  main,
  verifyStagedProject,
  verifyTemplate,
} from "../lib/cli.mjs";

const sourcePackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const workRoot = path.join(sourcePackageRoot, ".test-work");
let suiteRoot;
let packageRoot;

async function createPackageFixture(root) {
  const templateRoot = path.join(root, "dist", "template");
  const generatedPackage = {
    name: "expo-updates-server",
    version: "1.2.3",
    private: true,
    scripts: { start: "next start" },
  };
  const generatedLock = {
    name: "expo-updates-server",
    version: "1.2.3",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "expo-updates-server",
        version: "1.2.3",
      },
    },
  };
  const templateFiles = new Map([
    [".env.docker.example", "POSTGRES_PASSWORD=\n"],
    [".env.example", "DATABASE_URL=\n"],
    [".gitignore", "node_modules/\n"],
    ["Dockerfile", "FROM node:24-alpine\n"],
    ["README.md", "# Fixture\n"],
    ["docker-compose.yml", "services: {}\n"],
    ["docs/migrations/schema.sql", "SELECT 1;\n"],
    ["package-lock.json", `${JSON.stringify(generatedLock, null, 2)}\n`],
    ["package.json", `${JSON.stringify(generatedPackage, null, 2)}\n`],
  ]);
  const files = [];
  let totalSize = 0;

  await mkdir(templateRoot, { recursive: true });
  for (const [file, content] of templateFiles) {
    const bundledPath =
      file === ".gitignore" ? "gitignore.template" : file;
    const destination = path.join(
      templateRoot,
      ...bundledPath.split("/"),
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
    const size = Buffer.byteLength(content);
    totalSize += size;
    const entry = {
      path: file,
      size,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    if (bundledPath !== file) entry.bundledPath = bundledPath;
    files.push(entry);
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ version: "0.1.0" })}\n`,
  );
  await writeFile(
    path.join(root, "dist", "template-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        installerVersion: "0.1.0",
        sourceCommit: "0".repeat(40),
        totalSize,
        files,
      },
      null,
      2,
    )}\n`,
  );
}

before(async () => {
  await mkdir(workRoot, { recursive: true });
  suiteRoot = await mkdtemp(path.join(workRoot, "suite-"));
  packageRoot = path.join(suiteRoot, "package-fixture");
  await createPackageFixture(packageRoot);
});

after(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

function capture() {
  const stdout = [];
  const stderr = [];
  return {
    io: {
      log: (value) => stdout.push(String(value)),
      error: (value) => stderr.push(String(value)),
    },
    stdout,
    stderr,
  };
}

async function run(args, options = {}) {
  const output = capture();
  const code = await main(args, output.io, {
    packageRoot,
    cwd: suiteRoot,
    ...options,
  });
  return { code, ...output };
}

async function createValidStage(name) {
  const { manifest, templateRoot } = await verifyTemplate(packageRoot);
  const staging = path.join(suiteRoot, name);
  await mkdir(staging, { mode: 0o700 });
  await chmod(staging, 0o700);

  for (const entry of manifest.files) {
    const destination = path.join(staging, ...entry.path.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(
      path.join(
        templateRoot,
        ...(entry.bundledPath ?? entry.path).split("/"),
      ),
      destination,
    );
  }

  const stagingIdentity = await lstat(staging);
  assert.equal(stagingIdentity.mode & 0o777, 0o700);
  return { manifest, staging, stagingIdentity };
}

test("prints help for long and short options", async () => {
  for (const option of ["--help", "-h"]) {
    const result = await run([option]);
    assert.equal(result.code, 0);
    assert.match(result.stdout.join("\n"), /Usage:/);
    assert.equal(result.stderr.length, 0);
  }
});

test("prints the package version for long and short options", async () => {
  for (const option of ["--version", "-v"]) {
    const result = await run([option]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.stdout, ["0.1.0"]);
  }
});

test("rejects missing, extra, unknown, and combined arguments", async () => {
  const cases = [
    [],
    ["one", "two"],
    ["--force", "one"],
    ["--wat"],
    ["--help", "one"],
    ["-hv"],
  ];
  for (const args of cases) {
    const result = await run(args);
    assert.equal(result.code, 1, args.join(" "));
    assert.match(result.stderr.join("\n"), /^Error:/);
  }
});

test("creates an absent target with spaces and Unicode", async () => {
  const targetName = "my server \uD83D\uDE80";
  const result = await run([targetName]);
  assert.equal(result.code, 0);
  const generated = JSON.parse(
    await readFile(path.join(suiteRoot, targetName, "package.json"), "utf8"),
  );
  assert.equal(generated.name, "expo-updates-server");
  assert.equal(generated.private, true);
  assert.equal(generated.workspaces, undefined);
  assert.match(result.stdout.join("\n"), /Next steps \(Docker\):/);
  assert.match(result.stdout.join("\n"), /Next steps \(npm\):/);
});

test("creates a project in an empty current directory with dot", async () => {
  const target = path.join(suiteRoot, "current-directory");
  await mkdir(target);
  const before = await lstat(target);

  const result = await run(["."], { cwd: target });

  assert.equal(result.code, 0);
  const after = await lstat(target);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  const generated = JSON.parse(
    await readFile(path.join(target, "package.json"), "utf8"),
  );
  assert.equal(generated.name, "expo-updates-server");
  assert.equal(generated.workspaces, undefined);
  assert.doesNotMatch(result.stdout.join("\n"), /cd --/);
  await verifyStagedProject(
    target,
    (await verifyTemplate(packageRoot)).manifest,
  );
  assert.equal(
    (await readdir(suiteRoot)).some((entry) =>
      entry.startsWith(".create-expo-updates-server-"),
    ),
    false,
  );
});

test("refuses visible and hidden entries in the current directory unchanged", async () => {
  for (const entry of ["visible.txt", ".hidden"]) {
    const target = path.join(
      suiteRoot,
      `non-empty-current-${entry.replace(".", "dot")}`,
    );
    await mkdir(target);
    await writeFile(path.join(target, entry), "keep");
    const before = await lstat(target);

    const result = await run(["."], { cwd: target });

    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), /Current directory is not empty/);
    const after = await lstat(target);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.deepEqual(await readdir(target), [entry]);
    assert.equal(await readFile(path.join(target, entry), "utf8"), "keep");
  }
});

test("refuses a replaced current directory before installation", async () => {
  const target = path.join(suiteRoot, "replaced-current");
  const original = path.join(suiteRoot, "replaced-current-original");
  await mkdir(target);

  const result = await run(["."], {
    cwd: target,
    beforeInstall: async () => {
      await rename(target, original);
      await mkdir(target);
    },
  });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr.join("\n"),
    /Current directory was replaced before installation/,
  );
  assert.deepEqual(await readdir(target), []);
  assert.deepEqual(await readdir(original), []);
});

test("refuses a current directory replaced immediately before transfer", async () => {
  const target = path.join(suiteRoot, "replaced-current-at-transfer");
  const original = path.join(
    suiteRoot,
    "replaced-current-at-transfer-original",
  );
  await mkdir(target);

  const result = await run(["."], {
    cwd: target,
    beforeCurrentDirectoryTransfer: async () => {
      await rename(target, original);
      await mkdir(target);
    },
  });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr.join("\n"),
    /Current directory was replaced before installation/,
  );
  assert.deepEqual(await readdir(target), []);
  assert.deepEqual(await readdir(original), []);
});

test("only the literal dot argument enables current-directory installation", async () => {
  const target = path.join(suiteRoot, "literal-dot-only");
  await mkdir(target);

  for (const argument of [target, "missing/..", ""]) {
    const result = await run([argument], { cwd: target });
    assert.equal(result.code, 1, JSON.stringify(argument));
  }

  assert.deepEqual(await readdir(target), []);
});

test("does not overwrite a destination entry that appears during transfer", async () => {
  const target = path.join(suiteRoot, "concurrent-current-entry");
  const concurrentEntry = path.join(target, ".env.docker.example");
  await mkdir(target);

  const result = await run(["."], {
    cwd: target,
    beforeCurrentDirectoryTransfer: async () => {
      await writeFile(concurrentEntry, "external");
    },
  });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr.join("\n"),
    /Current directory is no longer empty; installation was not started/,
  );
  assert.match(result.stderr.join("\n"), /Staging directory retained at:/);
  assert.equal(await readFile(concurrentEntry, "utf8"), "external");
});

test("formats successful output with deterministic plain and colored modes", async () => {
  const plain = await run(["plain-output"], { color: false });
  assert.equal(plain.code, 0);
  const plainText = plain.stdout.join("\n");
  assert.doesNotMatch(plainText, /\u001B\[/);
  assert.match(plainText, /^✓ Expo Updates Server is ready/);
  assert.match(plainText, /Next steps \(Docker\):\n  1\. cd --/);
  assert.match(plainText, /Next steps \(npm\):\n  1\. cd --/);

  const colored = await run(["colored-output"], { color: true });
  assert.equal(colored.code, 0);
  const coloredText = colored.stdout.join("\n");
  assert.match(
    coloredText,
    /\u001B\[1;32m✓ Expo Updates Server is ready\u001B\[0m/,
  );
  assert.match(
    coloredText,
    /\u001B\[36mNext steps \(Docker\):\u001B\[0m/,
  );
  assert.match(coloredText, /\u001B\[93m1\.\u001B\[0m/);
  assert.match(coloredText, /\u001B\[93mnpm ci\u001B\[0m/);
});

test("refuses an existing empty target without changing its inode", async () => {
  const targetName = "existing-empty";
  const target = path.join(suiteRoot, targetName);
  await mkdir(target);
  const before = await lstat(target);
  const result = await run([targetName]);
  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /already exists/);
  const after = await lstat(target);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.deepEqual(await readdir(target), []);
});

test("refuses existing targets without changing their inode or content", async () => {
  for (const [name, entry] of [
    ["non-empty", "visible.txt"],
    ["hidden-entry", ".hidden"],
  ]) {
    const target = path.join(suiteRoot, name);
    await mkdir(target);
    await writeFile(path.join(target, entry), "keep");
    const before = await lstat(target);
    const result = await run([name]);
    assert.equal(result.code, 1);
    const after = await lstat(target);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(await readFile(path.join(target, entry), "utf8"), "keep");
  }

  const targetFile = path.join(suiteRoot, "target-file");
  await writeFile(targetFile, "keep");
  const fileBefore = await lstat(targetFile);
  const fileResult = await run(["target-file"]);
  assert.equal(fileResult.code, 1);
  const fileAfter = await lstat(targetFile);
  assert.equal(fileAfter.dev, fileBefore.dev);
  assert.equal(fileAfter.ino, fileBefore.ino);
  assert.equal(await readFile(targetFile, "utf8"), "keep");

  const targetLink = path.join(suiteRoot, "target-link");
  await symlink("target-file", targetLink);
  const linkBefore = await lstat(targetLink);
  const linkResult = await run(["target-link"]);
  assert.equal(linkResult.code, 1);
  const linkAfter = await lstat(targetLink);
  assert.equal(linkAfter.dev, linkBefore.dev);
  assert.equal(linkAfter.ino, linkBefore.ino);
  assert.equal(await readFile(targetLink, "utf8"), "keep");
});

test("detects checksum corruption before creating a target", async () => {
  const corruptPackage = path.join(suiteRoot, "corrupt-package");
  await mkdir(corruptPackage);
  await cp(path.join(packageRoot, "dist"), path.join(corruptPackage, "dist"), {
    recursive: true,
  });
  await cp(
    path.join(packageRoot, "package.json"),
    path.join(corruptPackage, "package.json"),
  );
  await writeFile(
    path.join(corruptPackage, "dist", "template", "README.md"),
    "corrupted\n",
  );

  await assert.rejects(
    verifyTemplate(corruptPackage),
    /checksum mismatch/,
  );
  const result = await run(["must-not-exist"], {
    packageRoot: corruptPackage,
  });
  assert.equal(result.code, 1);
  await assert.rejects(
    readdir(path.join(suiteRoot, "must-not-exist")),
    { code: "ENOENT" },
  );
});

test("renames a complete verified staging directory to an absent target", async () => {
  const staged = await createValidStage("verified-stage");
  const target = path.join(suiteRoot, "verified-target");
  await installStagedProject({ ...staged, target });
  await assert.rejects(lstat(staged.staging), { code: "ENOENT" });
  await verifyStagedProject(target, staged.manifest);
});

test("fails before rename for corrupt, missing, and additional staging files", async () => {
  const cases = [
    {
      name: "corrupt",
      mutate: async (location) => {
        const content = await readFile(location);
        content[0] ^= 1;
        await writeFile(location, content);
      },
      error: /checksum mismatch/,
    },
    {
      name: "missing",
      mutate: (location) => unlink(location),
      error: /paths do not match/,
    },
    {
      name: "additional",
      mutate: (_, staging) =>
        writeFile(path.join(staging, "unexpected.txt"), "unexpected"),
      error: /paths do not match/,
    },
  ];

  for (const value of cases) {
    const staged = await createValidStage(`${value.name}-stage`);
    const firstFile = path.join(
      staged.staging,
      ...staged.manifest.files[0].path.split("/"),
    );
    await value.mutate(firstFile, staged.staging);
    const target = path.join(suiteRoot, `${value.name}-target`);
    await assert.rejects(
      installStagedProject({ ...staged, target }),
      value.error,
    );
    await assert.rejects(lstat(target), { code: "ENOENT" });
    assert.equal((await lstat(staged.staging)).isDirectory(), true);
  }
});

test("fails the final absence check when a target appears and leaves it unchanged", async () => {
  const staged = await createValidStage("target-race-stage");
  const target = path.join(suiteRoot, "target-race");
  await mkdir(target);
  await writeFile(path.join(target, "external.txt"), "external");
  const before = await lstat(target);

  await assert.rejects(
    installStagedProject({ ...staged, target }),
    /already exists/,
  );

  const after = await lstat(target);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(
    await readFile(path.join(target, "external.txt"), "utf8"),
    "external",
  );
  assert.equal((await lstat(staged.staging)).isDirectory(), true);
});

test("preserves files, symlinks, and non-empty directories appearing at rename", async () => {
  for (const kind of ["file", "symlink", "directory"]) {
    const staged = await createValidStage(`${kind}-rename-stage`);
    const target = path.join(suiteRoot, `${kind}-rename-target`);
    const sentinel = path.join(suiteRoot, `${kind}-rename-sentinel`);
    await writeFile(sentinel, "external");
    let before;

    await assert.rejects(
      installStagedProject({
        ...staged,
        target,
        renameProject: async (source, destination) => {
          if (kind === "file") {
            await writeFile(destination, "external");
          } else if (kind === "symlink") {
            await symlink(sentinel, destination);
          } else {
            await mkdir(destination);
            await writeFile(path.join(destination, "external.txt"), "external");
          }
          before = await lstat(destination);
          await rename(source, destination);
        },
      }),
      /Target path (?:appeared|became)/,
    );

    const after = await lstat(target);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    if (kind === "directory") {
      assert.equal(
        await readFile(path.join(target, "external.txt"), "utf8"),
        "external",
      );
    } else {
      assert.equal(await readFile(target, "utf8"), "external");
    }
    assert.equal((await lstat(staged.staging)).isDirectory(), true);
  }
});

test("a replaced staging path is retained and its exact path is reported", async () => {
  let staging;
  let movedStage;
  let sentinel;
  const result = await run(["replacement-target"], {
    beforeInstall: async ({ staging: createdStaging }) => {
      staging = createdStaging;
      movedStage = `${createdStaging}-moved`;
      await rename(createdStaging, movedStage);
      await mkdir(createdStaging);
      sentinel = path.join(createdStaging, "external.txt");
      await writeFile(sentinel, "external replacement");
    },
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /Staging directory was replaced/);
  assert.ok(
    result.stderr
      .join("\n")
      .includes(`Staging directory retained at: ${staging}`),
  );
  assert.equal(await readFile(sentinel, "utf8"), "external replacement");
  assert.equal((await lstat(movedStage)).isDirectory(), true);
  await assert.rejects(
    lstat(path.join(suiteRoot, "replacement-target")),
    { code: "ENOENT" },
  );
});

test("manifest is sorted and generated template excludes denied files", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(packageRoot, "dist", "template-manifest.json"),
      "utf8",
    ),
  );
  const files = manifest.files.map((entry) => entry.path);
  assert.deepEqual(
    files,
    [...files].sort((left, right) => left.localeCompare(right, "en")),
  );
  for (const prefix of [
    ".git/",
    ".github/",
    "node_modules/",
    ".next/",
    "docs/.vitepress/",
    "docs/research/",
    "packages/create-expo-updates-server/",
  ]) {
    assert.equal(files.some((file) => file.startsWith(prefix)), false, prefix);
  }
  assert.equal(files.includes("docs/analytics-implementation-plan.md"), false);
  assert.equal(files.some((file) => /\.(?:pem|key|tgz)$/i.test(file)), false);
  for (const required of [
    ".env.example",
    ".env.docker.example",
    ".gitignore",
    "Dockerfile",
    "docker-compose.yml",
    "docs/migrations/2026-09-01-p1-guard-actions.sql",
    "docs/migrations/2026-09-01-p2-simplify-ota-guard-policy.sql",
    "docs/migrations/2026-09-01-policy-publication-correction.sql",
    "docs/migrations/schema.sql",
    "docs/ota-update-policy.md",
    "app/api/admin/guard-actions/route.ts",
    "app/api/admin/guard-actions/[id]/route.ts",
    "src/client/guard-action-combobox.tsx",
    "src/server/lib/guard-actions.ts",
    "package.json",
    "package-lock.json",
  ]) {
    assert.ok(files.includes(required), required);
  }

  const generatedPackage = JSON.parse(
    await readFile(
      path.join(packageRoot, "dist", "template", "package.json"),
      "utf8",
    ),
  );
  const generatedLock = JSON.parse(
    await readFile(
      path.join(packageRoot, "dist", "template", "package-lock.json"),
      "utf8",
    ),
  );
  assert.equal(generatedPackage.workspaces, undefined);
  assert.equal(
    Object.keys(generatedPackage.scripts).some((name) =>
      name.startsWith("installer:"),
    ),
    false,
  );
  assert.equal(generatedLock.packages[""].workspaces, undefined);
  assert.equal(
    Object.keys(generatedLock.packages).some((name) =>
      name.includes("create-expo-updates-server"),
    ),
    false,
  );
});
