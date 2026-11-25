import path from "node:path";
import { mkdir } from "node:fs/promises";
import { expect } from "@playwright/test";
import { seedPublication } from "./delivery.mjs";

export async function exercisePolicyEditor(page, { db, storage, password }) {
  const origin = new URL(page.url()).origin;
  const draft = await seedPublication(
    db,
    storage,
    "Policy editor fixture",
    false,
    "ios",
    { channel: "policy-browser" },
  );
  const api = origin + draft.path + "/policy";
  const releasePage = origin + draft.path.replace("/api/admin", "");
  const orphan = "app.contract-review";
  const seeded = await page.request.put(api, {
    data: {
      expectedPolicyVersion: 1,
      delivery: "background",
      guard: { action: orphan, payload: { revision: 2 } },
    },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(releasePage);
  await page.getByRole("tab", { name: "Policy", exact: true }).click();
  const tab = page.getByRole("tabpanel", { name: "Policy", exact: true });
  const radio = (name) => tab.getByRole("radio", { name, exact: true });
  const save = tab.getByRole("button", { name: "Save policy", exact: true });
  await expect(radio("Custom guard")).toBeChecked();
  await expect(
    tab.getByRole("combobox", { name: "Rule action" }),
  ).toContainText(orphan);
  await expect(tab.getByLabel("Delivery", { exact: true })).toContainText(
    "Background",
  );
  await expect(save).toBeDisabled();

  // The Radix group supports roving focus and preserves unsaved guard fields on a round trip.
  await radio("Custom guard").focus();
  await page.keyboard.down("ArrowUp");
  await expect(radio("Require a store update")).toBeChecked();
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowDown");
  await expect(radio("Custom guard")).toBeChecked();
  await page.keyboard.up("ArrowDown");
  await expect(save).toBeDisabled();
  await expect(tab.getByLabel("Optional custom JSON payload")).toHaveValue(
    /revision/,
  );

  await radio("Require a store update").click();
  const delivery = tab.getByRole("combobox", { name: "Delivery", exact: true });
  await expect(delivery).toHaveAccessibleDescription(/next full launch.*store button/i);
  await delivery.click();
  await page.getByRole("option", { name: "Manual", exact: true }).click();
  await expect(delivery).toHaveAccessibleDescription(/when to download and restart.*block the OTA download/i);
  await delivery.click();
  await page.getByRole("option", { name: "Background", exact: true }).click();
  await save.click();
  await expect(tab.getByRole("alert")).toContainText(
    "Enter a valid store link",
  );
  await tab
    .getByLabel("iOS store link", { exact: true })
    .fill("itms-apps://apps.apple.com/app/id42");
  await tab
    .getByLabel("Optional custom JSON payload")
    .fill('{"iosUrl":"itms-apps://apps.apple.com/app/id42","legacy":["keep"]}');
  await tab
    .getByLabel("Default store link", { exact: true })
    .fill("https://example.test/app");
  await save.click();
  await expect(
    tab.getByRole("status").filter({ hasText: "Policy saved as version 3." }),
  ).toBeVisible();
  const saved = await (await page.request.get(api)).json();
  expect(saved.guard).toEqual({
    action: "ota-force-store-update",
    payload: {
      iosUrl: "itms-apps://apps.apple.com/app/id42",
      legacy: ["keep"],
      url: "https://example.test/app",
    },
  });
  expect(saved.delivery).toBe("background");

  const initialViewport = page.viewportSize();
  const artifacts = process.env.OTA_E2E_ARTIFACTS;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
    if (artifacts)
      await tab.screenshot({
        path: path.join(artifacts, `policy-store-${width}.png`),
        style: "nextjs-portal { display:none; }",
      });
  }
  if (initialViewport) await page.setViewportSize(initialViewport);

  await radio("Custom guard").click();
  await tab.getByRole("button", { name: "New action", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    tab.getByRole("button", { name: "New action", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await tab
    .getByRole("textbox", { name: "Reusable action name" })
    .fill("app.verify-session");
  await page.keyboard.press("Enter");
  await expect(
    tab.getByRole("combobox", { name: "Rule action" }),
  ).toContainText("app.verify-session");
  await tab.getByLabel("Optional custom JSON payload").fill("{");
  await save.click();
  await expect(tab.getByRole("alert")).toContainText(
    "Guard payload must be valid JSON.",
  );
  await tab
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(radio("Require a store update")).toBeChecked();
  await expect(save).toBeDisabled();

  await radio("Required OTA update").click();
  await save.click();
  await expect(
    tab.getByRole("status").filter({ hasText: "Policy saved as version 4." }),
  ).toBeVisible();
  expect((await (await page.request.get(api)).json()).guard).toEqual({
    action: "ota-force-update",
  });
  const manualRequired = await (await page.request.get(api)).json();
  expect(manualRequired.delivery).toBe("manual");
  await radio("Immediate required update").click();
  await save.click();
  await expect(
    tab.getByRole("status").filter({ hasText: "Policy saved as version 5." }),
  ).toBeVisible();
  const immediate = await (await page.request.get(api)).json();
  expect(immediate.delivery).toBe("background");
  expect(immediate.guard).toEqual({ action: "ota-force-update" });
  await page.reload();
  await page.getByRole("tab", { name: "Policy", exact: true }).click();
  await expect(radio("Immediate required update")).toBeChecked();
  await radio("Background update").click();
  await save.click();
  await expect(
    tab.getByRole("status").filter({ hasText: "Policy saved as version 6." }),
  ).toBeVisible();
  expect((await (await page.request.get(api)).json()).guard).toBeNull();
  await radio("Optional update").click();
  await save.click();
  await expect(
    tab.getByRole("status").filter({ hasText: "Policy saved as version 7." }),
  ).toBeVisible();

  const catalogKey = "app.catalog-demo";
  await tab
    .getByRole("button", { name: "Action catalog", exact: true })
    .click();
  await tab
    .getByRole("textbox", { name: "Add action to catalog" })
    .fill(catalogKey);
  await tab
    .getByRole("button", { name: "Add to catalog", exact: true })
    .click();
  await tab
    .getByRole("searchbox", { name: "Search action catalog" })
    .fill(catalogKey);
  const catalog = tab.getByRole("list", {
    name: "Guard action catalog entries",
  });
  await expect(catalog.getByRole("listitem")).toHaveCount(1);
  await catalog
    .getByRole("button", { name: `Delete ${catalogKey} from action catalog` })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete from catalog" })
    .click();
  await expect(
    tab.getByText("No matching actions", { exact: true }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  expect((await (await page.request.get(api)).json()).policyVersion).toBe(7);

  const viewer = await page.context().browser().newContext();
  try {
    expect(
      (
        await viewer.request.post(origin + "/api/admin/login", {
          data: { username: "viewer", password },
        })
      ).status(),
    ).toBe(200);
    const screen = await viewer.newPage();
    await screen.goto(releasePage);
    await screen.getByRole("tab", { name: "Policy", exact: true }).click();
    const policy = screen.getByRole("tabpanel", {
      name: "Policy",
      exact: true,
    });
    await expect(policy.getByRole("radio").first()).toBeDisabled();
    await expect(
      policy.getByRole("button", { name: "Save policy" }),
    ).toHaveCount(0);
    await policy
      .getByRole("button", { name: "Action catalog", exact: true })
      .click();
    await expect(
      policy.getByRole("button", { name: "Add to catalog" }),
    ).toHaveCount(0);
  } finally {
    await viewer.close();
  }
  expect(
    (
      await page.request.post(origin + draft.path + "/deactivate", {
        data: { disabled: false },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.getByRole("tab", { name: "Policy", exact: true }).click();
  await expect(
    tab.getByText("Published policies are read-only.", { exact: false }),
  ).toBeVisible();
  await expect(radio("Optional update")).toBeDisabled();
  await expect(save).toHaveCount(0);
  console.log(
    "PASS policy profiles, keyboard selection, legacy payload preservation, save/discard, catalog, mobile layout and role locks",
  );
}
