import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { writeDatabaseRecords } from "../../../templates/expo-app/scripts/ota-publish/api/database-client.mjs";

const originalRuntime = "1.1.1";
const upgradedRuntime = "1.2.0";
const matrixChannel = "release-matrix";

export async function exerciseReleaseMatrix({
  db,
  storage,
  request,
  manifest,
}) {
  const deviceHeaders = {
    "expo-extra-params": 'device_id="' + "b".repeat(64) + '"',
  };
  const fastPublisherClock = Date.now() + 5 * 60_000;
  const guard = {
    action: "ota-force-update",
    payload: { message: "Install v2" },
  };

  // Feed the real publish writer a small, uniquely identifiable platform export.
  // Historical fixture dates keep the main console workflow's release on the first page.
  async function publish(
    platform,
    runtimeVersion,
    patch,
    { active = true, targeted = false, channel = matrixChannel } = {},
  ) {
    const id = randomUUID();
    const name = [channel, runtimeVersion, platform, "v" + patch].join("/");
    const bundle = Buffer.from(
      "globalThis.build = " + JSON.stringify(name) + ";",
    );
    // One CI clock is five minutes ahead of the server; native rollback still needs a newer date.
    const baseTime =
      platform === "android" && runtimeVersion === originalRuntime
        ? fastPublisherClock
        : Date.UTC(2024, 0, 1);
    const createdAt = new Date(baseTime + patch * 1000).toISOString();
    const prefix = [runtimeVersion, platform, channel, id].join("/");
    const launchAsset = {
      path: "bundle.js",
      key: id,
      contentType: "application/javascript",
      fileExtension: ".bundle",
      hash: createHash("sha256").update(bundle).digest("base64url"),
    };
    await storage.send(
      new PutObjectCommand({
        Bucket: "ota-fixtures",
        Key: prefix + "/bundle.js",
        Body: bundle,
      }),
    );
    const update = {
      id,
      buildId: id,
      runtimeVersion,
      platform,
      channel,
      createdAt,
      createdAtPath: id,
      expoClient: { name, version: "2.0." + patch },
      comment: name,
      launchAsset,
      assets: [],
      storageBucket: "ota-fixtures",
      storageBasePath: prefix,
    };
    await writeDatabaseRecords(db, update, { ...update, updateId: id });
    const path = "/api/admin/updates/" + Buffer.from(id).toString("base64url");
    if (targeted) {
      await request(path + "/audience", "PUT", {
        audience_mode: "devices",
        audience_device_ids: ["b".repeat(64)],
        audience_installation_ids: [],
        audience_version: 1,
      });
      await request(path + "/policy", "PUT", {
        expectedPolicyVersion: 1,
        delivery: "background",
        guard,
      });
    }
    if (active)
      await request(path + "/deactivate", "POST", { disabled: false });
    return { path, id, name, bundle, platform, runtimeVersion, channel };
  }

  function check(platform, runtimeVersion, headers = {}) {
    return manifest({
      "expo-platform": platform,
      "expo-runtime-version": runtimeVersion,
      "expo-channel-name": matrixChannel,
      ...headers,
    });
  }
  const running = ({ id }) => ({ "expo-current-update-id": id });
  async function expectNone(platform, runtime, headers) {
    const value = await check(platform, runtime, headers);
    assert.deepEqual(
      value,
      { type: "noUpdateAvailable" },
      "expected signed no-update for " + [platform, runtime].join("/"),
    );
  }
  async function expectRelease(release, headers) {
    const value = await check(release.platform, release.runtimeVersion, {
      "expo-channel-name": release.channel,
      ...headers,
    });
    assert.equal(
      value.extra?.expoClient.name,
      release.name,
      "expected signed manifest for " +
        release.name +
        "; received " +
        (value.type || value.id),
    );
    assert.equal(value.runtimeVersion, release.runtimeVersion);
    assert.equal(value.metadata.channel, release.channel);
    const response = await fetch(value.launchAsset.url, { headers });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, release.bundle);
    assert.equal(
      createHash("sha256").update(bytes).digest("base64url"),
      value.launchAsset.hash,
    );
    return value;
  }

  const releases = {};
  for (const platform of ["ios", "android"]) {
    // #17–24, #53–55: an unrelated runtime/platform produces only a signed directive.
    const v1 = await publish(platform, originalRuntime, 1);
    const first = await expectRelease(v1);
    await expectNone(platform, "1.1.0");
    await expectNone(platform, upgradedRuntime);
    if (platform === "ios") await expectNone("android", originalRuntime);

    // The newer targeted release can be retired while the older public release stays active.
    const v2 = await publish(platform, originalRuntime, 2, { targeted: true });
    const candidate = await expectRelease(v2, {
      ...deviceHeaders,
      ...running(first),
    });
    assert.deepEqual(candidate.extra.updatePolicy.guard, guard);
    await request(v2.path + "/deactivate", "POST", { disabled: true });

    // #27–31: clients that skipped the release stay put. A client already on
    // the retired release gets the older bundle, its own policy, and a fresh native timestamp.
    await expectNone(platform, originalRuntime, running(first));
    const fallback = await expectRelease(v1, {
      ...deviceHeaders,
      ...running(candidate),
    });
    assert.notEqual(fallback.id, candidate.id);
    assert.ok(
      Date.parse(fallback.createdAt) > Date.parse(candidate.createdAt),
      "fallback must be newer to Expo",
    );
    assert.equal(fallback.extra.updatePolicy.delivery, "manual");
    assert.equal(fallback.extra.updatePolicy.guard, undefined);
    await expectNone(platform, originalRuntime, {
      ...deviceHeaders,
      ...running(fallback),
    });

    const embedded = randomUUID();
    await request(
      "/api/admin/embedded-updates",
      "POST",
      {
        embeddedUpdateId: embedded,
        appVersion: "3.0.0",
        channel: matrixChannel,
        platform,
        createdAt: "2024-01-02T00:00:00Z",
      },
      201,
    );
    await expectNone(platform, originalRuntime, {
      ...deviceHeaders,
      ...running(candidate),
      "expo-embedded-update-id": embedded,
    });
    await request("/api/admin/embedded-updates/" + embedded, "DELETE");

    // #25–26, #32–33: reactivation, ignored draft, and a direct jump to the latest eligible patch.
    await request(v2.path + "/deactivate", "POST", { disabled: false });
    const reactivated = await expectRelease(v2, {
      ...deviceHeaders,
      ...running(fallback),
    });
    assert.ok(
      Date.parse(reactivated.createdAt) > Date.parse(fallback.createdAt),
    );
    const v3 = await publish(platform, originalRuntime, 3, {
      active: false,
      targeted: true,
    });
    await expectRelease(v2, { ...deviceHeaders, ...running(first) });
    await request(v3.path + "/deactivate", "POST", { disabled: false });
    await publish(platform, originalRuntime, 4, { active: false });
    const third = await expectRelease(v3, {
      ...deviceHeaders,
      ...running(first),
    });
    await expectNone(platform, originalRuntime, {
      ...deviceHeaders,
      ...running(third),
    });

    // #23, #69–70, #72: the new native runtime starts empty, then receives only its own v1.
    await expectNone(platform, upgradedRuntime, running(third));
    const newV1 = await publish(platform, upgradedRuntime, 1);
    const upgraded = await expectRelease(newV1);
    assert.notEqual(upgraded.id, first.id);
    await expectNone(platform, upgradedRuntime, running(upgraded));
    releases[platform] = newV1;
  }

  // #53, #56–57: byte-distinct patches with equal numbers, followed by independent platform histories.
  const iosV2 = await publish("ios", upgradedRuntime, 2);
  const androidV2 = await publish("android", upgradedRuntime, 2);
  const iosLatest = await expectRelease(iosV2);
  const androidSecond = await expectRelease(androidV2);
  assert.notEqual(iosLatest.launchAsset.hash, androidSecond.launchAsset.hash);
  let androidLatest = androidV2;
  for (const number of [3, 4, 5])
    androidLatest = await publish("android", upgradedRuntime, number);
  await expectRelease(androidLatest, running(androidSecond));
  await expectNone("ios", upgradedRuntime, running(iosLatest));
  await expectRelease(iosV2, running(releases.ios));
  // A private build in one channel must never replace a public build in another.
  const stable = await publish("ios", originalRuntime, 1, {
    channel: "production",
  });
  const beta = await publish("ios", originalRuntime, 1, {
    channel: "matrix-beta",
  });
  const restricted = await publish("ios", originalRuntime, 2, {
    channel: beta.channel,
    targeted: true,
  });
  const betaPublic = await expectRelease(beta);
  await expectRelease(restricted, { ...deviceHeaders, ...running(betaPublic) });
  await expectRelease(stable, deviceHeaders);
  await expectRelease(stable, { "expo-channel-name": " " });
  await expectRelease(beta, { "expo-channel-name": " MATRIX-BETA " });
  await expectNone("ios", originalRuntime, {
    ...deviceHeaders,
    "expo-channel-name": "matrix-unpublished",
  });
  await expectNone("ios", originalRuntime, {
    ...running(betaPublic),
    "expo-channel-name": beta.channel,
  });

  console.log(
    "PASS signed HTTP release matrix: both platform stacks, active/draft selection, scoped retired-build fallback, embedded floor, skipped versions, native runtime transition, normalized/empty/unknown channels and targeted channel isolation",
  );
}
