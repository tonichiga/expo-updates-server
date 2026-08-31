import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { validateReleaseRef } from "../scripts/validate-release-ref.mjs";

let repository;

function git(args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

before(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), "release-ref-test-"));
  git(["init", "-q"]);
  git(["config", "user.name", "Release Test"]);
  git(["config", "user.email", "release-test@example.invalid"]);
  await writeFile(path.join(repository, "source.txt"), "main\n");
  git(["add", "."]);
  git(["commit", "-qm", "main"]);
  git(["branch", "-M", "main"]);
});

after(async () => {
  await rm(repository, { recursive: true, force: true });
});

test("accepts a matching installer tag merged into main", () => {
  const tag = "create-expo-updates-server-v1.2.3";
  git(["tag", tag]);
  const commit = git(["rev-parse", "HEAD"]);
  const result = validateReleaseRef({
    tag,
    eventSha: commit,
    mainRef: "main",
    cwd: repository,
  });
  assert.equal(result.tagCommit, commit);
});

test("rejects a matching tag whose commit is not merged into main", async () => {
  git(["checkout", "-qb", "unmerged", "main"]);
  await writeFile(path.join(repository, "source.txt"), "unmerged\n");
  git(["add", "."]);
  git(["commit", "-qm", "unmerged"]);
  const tag = "create-expo-updates-server-v1.2.4";
  git(["tag", tag]);
  const commit = git(["rev-parse", "HEAD"]);

  assert.throws(
    () =>
      validateReleaseRef({
        tag,
        eventSha: commit,
        mainRef: "main",
        cwd: repository,
      }),
    /not an ancestor/,
  );
});

test("rejects disagreement between the tag and event commit", () => {
  const tag = "create-expo-updates-server-v1.2.3";
  const sideCommit = git(["rev-parse", "HEAD"]);
  assert.throws(
    () =>
      validateReleaseRef({
        tag,
        eventSha: sideCommit,
        mainRef: "main",
        cwd: repository,
      }),
    /differ/,
  );
});
