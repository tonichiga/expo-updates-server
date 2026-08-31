import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  assertNoSecretContent,
  buildTemplate,
  maximumManifestSize,
  maximumTemplateFileSize,
  maximumTemplateSize,
  serializeManifest,
  validateTemplateSizes,
} from "../scripts/build-template.mjs";

let workRoot;

before(async () => {
  workRoot = await mkdtemp(path.join(os.tmpdir(), "template-build-test-"));
});

after(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

test("build materializes every template byte from the recorded commit", async () => {
  const root = path.join(workRoot, "repository");
  const installer = path.join(
    root,
    "packages",
    "create-expo-updates-server",
  );
  await mkdir(installer, { recursive: true });
  const committedPackage = {
    name: "source-project",
    version: "1.2.3",
    private: true,
    workspaces: ["packages/*"],
    scripts: {
      start: "node server.mjs",
      "installer:test": "must-be-removed",
    },
  };
  const committedLock = {
    name: "source-project",
    version: "1.2.3",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "source-project",
        version: "1.2.3",
        workspaces: ["packages/*"],
      },
      "packages/create-expo-updates-server": {
        name: "create-expo-updates-server",
        version: "0.1.0",
      },
    },
  };
  await writeFile(path.join(root, "README.md"), "committed bytes\n");
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(committedPackage, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "package-lock.json"),
    `${JSON.stringify(committedLock, null, 2)}\n`,
  );
  await writeFile(
    path.join(installer, "package.json"),
    `${JSON.stringify({ version: "0.1.0" })}\n`,
  );
  await writeFile(
    path.join(installer, "template-policy.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      include: [
        "README.md",
        "package.json",
        "package-lock.json",
        "templates/**",
      ],
      deny: [],
    })}\n`,
  );

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Template Test"]);
  git(root, ["config", "user.email", "template-test@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  const sourceCommit = git(root, ["rev-parse", "HEAD"]);

  await writeFile(
    path.join(installer, "package.json"),
    `${JSON.stringify({ version: "9.9.9" })}\n`,
  );
  await writeFile(
    path.join(installer, "template-policy.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      include: ["dirty-only.txt"],
      deny: [],
    })}\n`,
  );
  await writeFile(path.join(root, "README.md"), "dirty bytes\n");
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ ...committedPackage, name: "dirty-project" })}\n`,
  );
  await writeFile(
    path.join(root, "package-lock.json"),
    `${JSON.stringify({ ...committedLock, name: "dirty-project" })}\n`,
  );
  const newExample = path.join(
    root,
    "templates",
    "expo-app",
    ".env.ota.example",
  );
  await mkdir(path.dirname(newExample), { recursive: true });
  await writeFile(newExample, "OTA_ACCESS_TOKEN=\n");

  await buildTemplate({ repositoryRoot: root, packageDir: installer });

  assert.equal(
    await readFile(path.join(installer, "dist", "template", "README.md"), "utf8"),
    "committed bytes\n",
  );
  const generatedPackage = JSON.parse(
    await readFile(
      path.join(installer, "dist", "template", "package.json"),
      "utf8",
    ),
  );
  const generatedLock = JSON.parse(
    await readFile(
      path.join(installer, "dist", "template", "package-lock.json"),
      "utf8",
    ),
  );
  const manifest = JSON.parse(
    await readFile(
      path.join(installer, "dist", "template-manifest.json"),
      "utf8",
    ),
  );
  assert.equal(generatedPackage.name, "expo-updates-server");
  assert.equal(generatedPackage.workspaces, undefined);
  assert.deepEqual(generatedPackage.scripts, { start: "node server.mjs" });
  assert.equal(generatedLock.name, "expo-updates-server");
  assert.equal(generatedLock.packages[""].workspaces, undefined);
  assert.equal(
    generatedLock.packages["packages/create-expo-updates-server"],
    undefined,
  );
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.installerVersion, "0.1.0");
  await assert.rejects(
    readFile(
      path.join(
        installer,
        "dist",
        "template",
        "templates",
        "expo-app",
        ".env.ota.example",
      ),
    ),
    { code: "ENOENT" },
  );

  git(root, ["add", "templates/expo-app/.env.ota.example"]);
  git(root, ["commit", "-qm", "track template example"]);
  const exampleCommit = git(root, ["rev-parse", "HEAD"]);
  await buildTemplate({ repositoryRoot: root, packageDir: installer });
  assert.equal(
    await readFile(
      path.join(
        installer,
        "dist",
        "template",
        "templates",
        "expo-app",
        ".env.ota.example",
      ),
      "utf8",
    ),
    "OTA_ACCESS_TOKEN=\n",
  );
  const updatedManifest = JSON.parse(
    await readFile(
      path.join(installer, "dist", "template-manifest.json"),
      "utf8",
    ),
  );
  assert.equal(updatedManifest.sourceCommit, exampleCommit);
});

test("secret checks reject populated credentials and private material", () => {
  for (const content of [
    "DATABASE_URL=prefix-redacted-host-placeholder\n",
    "DATABASE_URL=prefix-******host:5432/database\n",
    "POSTGRES_PASSWORD=your-password-real\n",
    "POSTGRES_PASSWORD=replace-with-a-strong-storage-password-prod\n",
    "DATABASE_URL=postgresql://user:real-password@prod.internal/db\n",
    "POSTGRES_PASSWORD=Tr0ub4dor-and-a-real-password\n",
    "R2_SECRET_ACCESS_KEY=r2-secret-value-that-is-populated\n",
    "SUPABASE_SERVICE_ROLE_KEY=service-role-value-that-is-populated\n",
    "OTA_ACCESS_TOKEN=ota_abcdefghijklmnopqrstuvwxyz012345\n",
    '"DATABASE_URL": "postgresql://real.example/database"\n',
    "SUPABASE_SERVICE_ROLE_KEY: service-role-value-that-is-populated\n",
    "-----BEGIN PRIVATE KEY-----\n" +
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCy\n" +
      "-----END PRIVATE KEY-----\n",
  ]) {
    assert.throws(
      () => assertNoSecretContent(".env.example", Buffer.from(content)),
      /probable secret|populated sensitive value/,
      content,
    );
  }
});

test("secret checks allow exact empty and committed placeholder values", () => {
  assert.doesNotThrow(() =>
    assertNoSecretContent(
      ".env.example",
      Buffer.from(
        [
          'DATABASE_URL="******host:5432/database"',
          "POSTGRES_PASSWORD=replace-with-a-strong-storage-password",
          "R2_SECRET_ACCESS_KEY=<secret-access-key>",
          "SUPABASE_SERVICE_ROLE_KEY=<service-role-key>",
          "OTA_ACCESS_TOKEN=",
          '"FLAGS_SECRET": "",',
          "CODE_SIGNING_PRIVATE_KEY: ${CODE_SIGNING_PRIVATE_KEY:-}",
        ].join("\n"),
      ),
    ),
  );
});

test("an empty sensitive assignment does not consume the next line", () => {
  assert.doesNotThrow(() =>
    assertNoSecretContent(
      ".env.example",
      Buffer.from(
        "R2_SECRET_ACCESS_KEY=\nR2_BUCKET=expo-updates\n",
      ),
    ),
  );
});

test("template and manifest size limits reject synthetic oversized metadata", () => {
  assert.equal(
    validateTemplateSizes([
      { path: "one", size: maximumTemplateFileSize },
      { path: "two", size: 1 },
    ]),
    maximumTemplateFileSize + 1,
  );
  assert.throws(
    () =>
      validateTemplateSizes([
        { path: "oversized", size: maximumTemplateFileSize + 1 },
      ]),
    /file exceeds/,
  );
  assert.throws(
    () =>
      validateTemplateSizes([
        { path: "one", size: maximumTemplateFileSize },
        { path: "two", size: maximumTemplateFileSize },
        { path: "three", size: maximumTemplateFileSize },
        { path: "four", size: maximumTemplateFileSize },
        { path: "five", size: maximumTemplateFileSize },
        { path: "six", size: 1 },
      ]),
    /total limit/,
  );
  assert.equal(maximumTemplateSize, 5 * maximumTemplateFileSize);
  assert.throws(
    () =>
      serializeManifest({
        padding: "x".repeat(maximumManifestSize),
      }),
    /manifest exceeds/,
  );
});

test("the complete Expo app environment template passes secret checks", async () => {
  const fixture = await readFile(
    new URL("fixtures/expo-app.env.ota.example", import.meta.url),
  );
  const source = await readFile(
    new URL(
      "../../../templates/expo-app/.env.ota.example",
      import.meta.url,
    ),
  );
  assert.deepEqual(source, fixture);
  assert.doesNotThrow(() =>
    assertNoSecretContent(
      "templates/expo-app/.env.ota.example",
      fixture,
    ),
  );
});
