import { randomBytes, randomUUID } from "node:crypto";
import { expect as playwrightExpect } from "@playwright/test";
import { seedPublication } from "./delivery.mjs";

const expect = playwrightExpect.configure({ timeout: 30_000 });

export async function exerciseDeviceFavorites(
  page,
  { origin, db, storage, password },
) {
  const runtime = "favorites-e2e";
  const platform = "android";
  const installationId = randomUUID();
  const deviceId = randomBytes(32).toString("hex");
  const draft = await seedPublication(
    db,
    storage,
    "Favorite smoke draft",
    false,
    platform,
    { runtime, channel: "favorites" },
  );
  const path = draft.path.replace("/api/admin", "");
  const api = origin + "/api/admin/device-favorites";
  const listUrl = api + "?platform=android";
  const audience = origin + draft.path + "/audience";
  const target = { platform, target_kind: "device", target_id: deviceId };
  const heartbeat = await page.request.post(origin + "/api/device-heartbeat", {
    data: {
      platform,
      installationId,
      deviceId,
      sequence: 1,
      eventId: randomUUID(),
      observedAt: new Date().toISOString(),
      channel: "favorites",
      runtimeVersion: runtime,
      updateId: null,
      nativeVersion: "1.0",
      nativeBuild: "1",
      isEmbeddedLaunch: true,
      isEmergencyLaunch: false,
    },
  });
  expect(await heartbeat.json()).toEqual({ status: "accepted" });

  await page.goto(origin + "/updates/devices");
  await page.getByRole("tab", { name: "Registry", exact: true }).click();
  await page
    .getByRole("button", { name: "Installation details " + installationId })
    .click();
  const details = page.getByRole("dialog", { name: "Installation details" });
  await details
    .getByRole("button", { name: "Bookmark " + installationId })
    .click();
  const fromRegistry = page.getByRole("dialog", { name: "Save favorite" });
  await fromRegistry.getByLabel("Favorite name").fill("From registry");
  await fromRegistry.getByRole("button", { name: "Save favorite" }).click();
  await expect(fromRegistry).toBeHidden();
  await expect(details).toBeVisible();
  await page.goto(origin + path);
  const mode = page.getByRole("radio", {
    name: "Selected devices / installations only",
  });
  await mode.click();
  await page
    .getByRole("textbox", { name: "Find a recipient" })
    .fill(installationId);
  const bookmark = page.getByRole("button", {
    name: "Bookmark " + installationId,
  });
  const dialog = page.getByRole("dialog", { name: "Save favorite" });
  const favorites = page.getByRole("region", { name: "My favorites" });
  const deviceName = "My QA phone";
  const installationName = "Single installation";
  for (const [kind, name] of [
    ["device", deviceName],
    ["installation", installationName],
  ]) {
    await bookmark.click();
    await dialog.getByLabel("Bookmark target").selectOption(kind);
    if (kind === "device") {
      await expect(dialog.getByLabel("Favorite name")).toHaveValue(
        "From registry",
      );
    }
    await dialog.getByLabel("Favorite name").fill(name);
    await dialog.getByRole("button", { name: "Save favorite" }).click();
    await expect(dialog).toBeHidden();
    await expect(favorites.getByText(name, { exact: true })).toBeVisible();
  }
  expect((await (await page.request.get(audience)).json()).audience_mode).toBe(
    "all",
  );
  // An older heartbeat stays selectable, with its actual observation time.
  await db.query(
    "update ota_device_state set last_seen_at=last_seen_at - interval '60 days' where platform=$1 and installation_id=$2",
    [platform, installationId],
  );
  await page.reload();
  await mode.click();
  await expect(favorites.locator("time")).toHaveCount(2);
  const seen = await favorites.locator("time").first().getAttribute("datetime");
  expect(Date.now() - Date.parse(seen)).toBeGreaterThan(59 * 86400000);
  const add = (name) =>
    favorites.getByRole("button", { name: "Add " + name + " to audience" });
  await add(deviceName).click();
  await expect(
    favorites.getByRole("button", { name: deviceName + " is selected" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save audience" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(audience)).json()).audience_device_ids,
    )
    .toEqual([deviceId]);
  await favorites
    .getByRole("button", { name: "Remove " + deviceName + " from favorites" })
    .click();
  await expect(favorites.getByText(deviceName, { exact: true })).toHaveCount(0);
  await add(installationName).click();
  await page.getByRole("button", { name: "Save audience" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(audience)).json())
          .audience_installation_ids,
    )
    .toEqual([installationId]);
  expect(
    (await (await page.request.get(audience)).json()).audience_device_ids,
  ).toEqual([deviceId]);
  const pub = await db.query(
    "select is_active from ota_updates where update_id=$1",
    [draft.id],
  );
  expect(pub.rows[0].is_active).toBe(false);

  const installTarget = {
    platform,
    target_kind: "installation",
    target_id: installationId,
  };
  const {
    rows: [other],
  } = await db.query(
    "insert into ota_admin_users(username,password_hash,role) select $1,password_hash,'operator' from ota_admin_users where username='admin' returning id,username",
    ["operator-" + randomUUID().slice(0, 8)],
  );
  const browser = page.context().browser();
  for (const username of [other.username, "viewer"]) {
    const session = await browser.newContext();
    try {
      expect((await session.request.get(listUrl)).status()).toBe(401);
      expect(
        (
          await session.request.post(origin + "/api/admin/login", {
            data: { username, password },
          })
        ).status(),
      ).toBe(200);
      expect(
        (await (await session.request.get(listUrl)).json()).favorites,
      ).toEqual([]);
      const own = { ...installTarget, name: "Operator bookmark" };
      if (username === "viewer") {
        expect((await session.request.put(api, { data: own })).status()).toBe(
          403,
        );
        expect(
          (await session.request.delete(api, { data: installTarget })).status(),
        ).toBe(403);
        const screen = await session.newPage();
        await screen.goto(origin + path);
        await expect(
          screen.getByRole("heading", { name: "My favorites" }),
        ).toBeVisible();
        await expect(
          screen.getByRole("button", { name: /^Bookmark / }),
        ).toHaveCount(0);
      } else {
        expect((await session.request.put(api, { data: own })).status()).toBe(
          200,
        );
        expect(
          (await (await session.request.get(listUrl)).json()).favorites[0].name,
        ).toBe(own.name);
        expect(
          (await session.request.delete(api, { data: installTarget })).status(),
        ).toBe(200);
      }
    } finally {
      await session.close();
    }
  }
  expect(
    (await (await page.request.get(listUrl)).json()).favorites[0].name,
  ).toBe(installationName);
  expect(
    (await (await page.request.get(api + "?platform=ios")).json()).favorites,
  ).toEqual([]);
  expect(
    (
      await page.request.put(api, { data: { ...target, name: deviceName } })
    ).status(),
  ).toBe(200);
  await db.query(
    "delete from ota_device_state where platform=$1 and installation_id=$2",
    [platform, installationId],
  );
  await page.reload();
  await expect(
    favorites.getByText("Target is no longer in the registry"),
  ).toHaveCount(2);
  // Clearing a selected ID locally makes its Add control visible. A missing
  // registry target is still unavailable even when it is no longer selected.
  await page
    .getByRole("button", { name: /Selected IDs and manual entry/ })
    .click();
  await page.getByLabel("Device IDs", { exact: true }).fill("");
  await expect(add(deviceName)).toBeDisabled();
  await expect(
    favorites.getByRole("button", { name: installationName + " is selected" }),
  ).toBeDisabled();
  expect(
    (
      await page.request.put(api, { data: { ...target, name: deviceName } })
    ).status(),
  ).toBe(404);
  await favorites
    .getByRole("button", {
      name: "Remove " + installationName + " from favorites",
    })
    .click();
  await expect(
    favorites.getByText(installationName, { exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get(audience)).json()).audience_installation_ids,
  ).toEqual([installationId]);
  console.log(
    "PASS personal device/installation favorites, role and account isolation, draft targeting, independent removal and missing telemetry",
  );
}
