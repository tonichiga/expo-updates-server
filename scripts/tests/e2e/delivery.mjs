import { exerciseReleaseMatrix } from "./release-matrix.mjs";
import assert from "node:assert/strict";
import { createHash, randomUUID, verify } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const runtime = "1.0.0";
const channel = "production";
export async function seedPublication(
  db,
  storage,
  comment,
  active = false,
  platform = "ios",
  scope = {},
) {
  const runtime = scope.runtime ?? "1.0.0";
  const channel = scope.channel ?? "production";
  const id = randomUUID();
  const prefix = runtime + "/" + platform + "/" + id;
  const bundle = Buffer.from(
    "globalThis.otaBuild = " + JSON.stringify(comment) + ";",
  );
  const image = Buffer.from([137, 80, 78, 71]);
  const assets = [];
  for (const [key, bytes, contentType, fileExtension] of [
    ["bundle.js", bundle, "application/javascript", ".js"],
    ["icon.png", image, "image/png", ".png"],
  ]) {
    await storage.send(
      new PutObjectCommand({
        Bucket: "ota-fixtures",
        Key: prefix + "/" + key,
        Body: bytes,
      }),
    );
    assets.push({
      key,
      path: key,
      hash: createHash("sha256").update(bytes).digest("base64url"),
      contentType,
      fileExtension,
    });
  }
  await db.query(
    `insert into ota_updates(update_id,build_id,runtime_version,channel,platform,created_at,
    created_at_path,storage_bucket,storage_base_path,manifest,assets_count,launch_asset_path,comment)
    values($1::uuid,$1::uuid,$2,$3,$4,clock_timestamp(),$1::uuid::text,'ota-fixtures',$5,$6,1,'bundle.js',$7)`,
    [
      id,
      runtime,
      channel,
      platform,
      prefix,
      {
        runtimeVersion: runtime,
        launchAsset: assets[0],
        assets: [assets[1]],
        extra: { expoClient: { name: comment, version: "1.0" } },
      },
      comment,
    ],
  );
  await db.query(
    `insert into ota_update_channels(runtime_version,channel,platform)
     values($1,$2,$3) on conflict(runtime_version,channel,platform) do nothing`,
    [runtime, channel, platform],
  );
  if (active) await db.query("select * from ota_change_distribution($1,'activate')", [id]);
  return {
    id,
    path: "/api/admin/updates/" + Buffer.from(id).toString("base64url"),
    bundle,
    image,
    comment,
  };
}

export async function exerciseDelivery({
  origin,
  db,
  storage,
  password,
  publicKey,
  old,
}) {
  const response = await fetch(origin + "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(response.status, 200, await response.text());
  const cookie = response.headers.get("set-cookie").split(";")[0];
  async function request(path, method = "GET", body, status = 200) {
    const res = await fetch(origin + path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    assert.equal(
      res.status,
      status,
      method + " " + path + " " + JSON.stringify(result),
    );
    return result;
  }
  async function manifest(extra = {}) {
    const res = await fetch(origin + "/api/manifest", {
      headers: {
        "expo-platform": "ios",
        "expo-channel-name": channel,
        "expo-runtime-version": runtime,
        "expo-protocol-version": "1",
        "expo-expect-signature": "sig, keyid=main",
        ...extra,
      },
    });
    const raw = await res.text();
    assert.equal(res.status, 200, raw);
    const boundary = res.headers
      .get("content-type")
      .match(/boundary="?([^";]+)/)[1];
    const part = raw
      .split("--" + boundary)
      .find((value) => /name="(?:manifest|directive)"/i.test(value));
    assert.ok(part, raw);
    const [headers, body] = part.trim().split("\r\n\r\n");
    const signature = headers.match(/expo-signature: sig="([^"]+)"/i)?.[1];
    assert.ok(
      signature &&
        verify(
          "RSA-SHA256",
          Buffer.from(body),
          publicKey,
          Buffer.from(signature, "base64"),
        ),
      "signature matches exact payload",
    );
    return JSON.parse(body);
  }
  async function expectArtifact(value, release) {
    assert.equal(value.extra.expoClient.name, release.comment);
    for (const asset of [value.launchAsset, ...value.assets]) {
      const res = await fetch(asset.url);
      assert.equal(res.status, 200);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(
        bytes,
        asset === value.launchAsset ? release.bundle : release.image,
      );
      assert.equal(
        createHash("sha256").update(bytes).digest("base64url"),
        asset.hash,
      );
    }
  }
  async function noUpdate(headers) {
    assert.equal((await manifest(headers)).type, "noUpdateAvailable");
  }
  await expectArtifact(await manifest(), old);
  const legacyManifest = await manifest();
  await noUpdate({ "expo-current-update-id": legacyManifest.id });
  for (const headers of [
    { "expo-platform": "android" },
    { "expo-runtime-version": "other" },
    { "expo-channel-name": "beta" },
  ])
    await noUpdate(headers);
  const android = await seedPublication(
    db,
    storage,
    "Android release",
    true,
    "android",
  );
  await expectArtifact(await manifest({ "expo-platform": "android" }), android);

  const draft = await seedPublication(db, storage, "Candidate release");
  await expectArtifact(await manifest(), old);
  const guard = {
    action: "ota-force-store-update",
    payload: { message: "Upgrade" },
  };
  await request(draft.path + "/policy", "PUT", {
    expectedPolicyVersion: 1,
    delivery: "background",
    guard,
  });
  const installation = randomUUID();
  const audience = {
    audience_mode: "devices",
    audience_device_ids: ["a".repeat(64)],
    audience_installation_ids: [installation],
    audience_version: 1,
  };
  await request(draft.path + "/audience", "PUT", audience);
  await request(draft.path + "/audience", "PUT", audience, 409);
  await request(draft.path + "/deactivate", "POST", { disabled: false });
  await request(
    draft.path + "/policy",
    "PUT",
    { expectedPolicyVersion: 2, delivery: "manual", guard: null },
    409,
  );
  for (const extra of [
    'device_id="' + "a".repeat(64) + '"',
    'installation_id="' + installation + '"',
  ]) {
    const targeted = await manifest({ "expo-extra-params": extra });
    await expectArtifact(targeted, draft);
    assert.deepEqual(targeted.extra.updatePolicy.guard, guard);
    assert.equal(targeted.extra.updatePolicy.delivery, "background");
  }
  await expectArtifact(await manifest(), old);
  await request(draft.path + "/audience", "PUT", {
    ...audience,
    audience_mode: "all",
    audience_installation_ids: [],
    audience_device_ids: [],
    audience_version: 2,
  });
  const wide = await manifest();
  await expectArtifact(wide, draft);
  const controlPath = "/api/admin/distribution-control";
  const initial = await request(controlPath);
  const paused = await request(controlPath, "PUT", {
    blocked: true,
    reason: "E2E rehearsal",
    expectedVersion: initial.version,
  });
  await noUpdate({});
  assert.equal((await fetch(wide.launchAsset.url)).status, 503);
  await request(controlPath, "PUT", {
    blocked: false,
    expectedVersion: paused.version,
  });
  await expectArtifact(await manifest(), draft);
  await request(old.path + "/rollback", "POST", {});
  await expectArtifact(
    await manifest({ "expo-current-update-id": wide.id }),
    old,
  );
  await request(draft.path + "/promote", "POST", {});
  await expectArtifact(await manifest(), draft);
  const embedded = randomUUID();
  await request(
    "/api/admin/embedded-updates",
    "POST",
    {
      embeddedUpdateId: embedded,
      appVersion: "1.0",
      channel: "beta",
      platform: "ios",
      createdAt: "2025-01-01T00:00:00Z",
    },
    201,
  );
  const rule = await request(
    "/api/admin/emergency-redirects",
    "POST",
    {
      name: "Beta recovery",
      enabled: true,
      embeddedUpdateId: embedded,
      runtimeVersion: runtime,
      platform: "ios",
      fromChannel: "beta",
      toChannel: channel,
      targetMode: "pinned",
      expectedUpdateId: draft.id,
    },
    201,
  );
  const source = {
    "expo-channel-name": "beta",
    "expo-embedded-update-id": embedded,
  };
  await expectArtifact(await manifest(source), draft);
  await noUpdate({ ...source, "expo-embedded-update-id": randomUUID() });
  await request("/api/admin/emergency-redirects/" + rule.id, "PATCH", {
    enabled: false,
  });
  await noUpdate(source);
  await request("/api/admin/emergency-redirects/" + rule.id, "PATCH", {
    enabled: true,
    targetMode: "follow",
    expectedUpdateId: null,
  });
  await expectArtifact(await manifest(source), draft);
  await request("/api/admin/emergency-redirects/" + rule.id, "DELETE");
  await noUpdate(source);
  await exerciseReleaseMatrix({ db, storage, request, manifest });
  console.log(
    "PASS signed manifests, signed directives, asset bytes, platform/runtime/channel, targeting, Guard, stale edits, widening, stop/resume, rollback/promote, emergency recovery",
  );
}
