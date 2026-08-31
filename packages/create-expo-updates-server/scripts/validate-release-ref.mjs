import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveCommit(cwd, revision) {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "--verify", `${revision}^{commit}`],
      { cwd, encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error(`Release revision does not resolve to a commit: ${revision}`);
  }
}

export function validateReleaseRef({
  tag,
  eventSha,
  mainRef = "origin/main",
  cwd = process.cwd(),
}) {
  if (!/^create-expo-updates-server-v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Invalid installer release tag: ${tag}`);
  }
  if (!/^[0-9a-f]{40}$/.test(eventSha)) {
    throw new Error(`Invalid release event commit: ${eventSha}`);
  }

  const tagCommit = resolveCommit(cwd, `refs/tags/${tag}`);
  const checkoutCommit = resolveCommit(cwd, "HEAD");
  const mainCommit = resolveCommit(cwd, mainRef);
  if (tagCommit !== eventSha || checkoutCommit !== eventSha) {
    throw new Error("Release tag, event commit, and checked-out commit differ");
  }

  const ancestry = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", tagCommit, mainCommit],
    { cwd, encoding: "utf8" },
  );
  if (ancestry.status === 1) {
    throw new Error(`Tagged commit is not an ancestor of ${mainRef}`);
  }
  if (ancestry.status !== 0) {
    throw new Error(
      `Could not validate release ancestry: ${ancestry.stderr.trim()}`,
    );
  }

  return { tagCommit, mainCommit };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [tag, eventSha, mainRef] = process.argv.slice(2);
    const result = validateReleaseRef({ tag, eventSha, mainRef });
    console.log(
      `Validated ${tag} at ${result.tagCommit} as merged into ${mainRef}.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
