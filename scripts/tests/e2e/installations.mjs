import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

// The signed-in page belongs to the disposable stack created by run.mjs.
export async function exerciseInstallations(page) {
  const origin = new URL(page.url()).origin;
  const runtime = "browser-installations";
  const id = randomUUID();
  for (const [installationId, channel, nativeBuild] of [
    [id, "analytics-ios", "12"],
    [randomUUID(), "analytics-ios", "13"],
    [randomUUID(), "analytics-preview", "12"],
  ]) {
    const response = await page.request.post(origin + "/api/device-heartbeat", {
      data: {
        installationId,
        eventId: randomUUID(),
        sequence: 1,
        observedAt: new Date().toISOString(),
        platform: "ios",
        channel,
        runtimeVersion: runtime,
        nativeVersion: "1.0",
        nativeBuild,
        updateId: null,
        isEmbeddedLaunch: true,
        isEmergencyLaunch: false,
      },
    });
    assert.deepEqual(await response.json(), { status: "accepted" });
  }

  await page.goto(origin + "/updates/devices");
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await page.getByLabel("Runtime", { exact: true }).selectOption(runtime);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show daily values", exact: true })
    .click();
  const daily = page.getByRole("table", {
    name: "Show daily values",
    exact: true,
  });
  await expect(daily.getByRole("row").last().getByRole("cell")).toHaveText([
    /./,
    "3",
    "3",
    "Partial day",
  ]);
  await expect(daily.getByRole("row").nth(1).getByRole("cell")).toHaveText([
    /./,
    "—",
    "—",
    "No data",
  ]);

  await page.getByRole("tab", { name: "Versions", exact: true }).click();
  const ios = page.getByRole("region", {
    name: "Channel analytics-ios, ios",
    exact: true,
  });
  const preview = page.getByRole("region", {
    name: "Channel analytics-preview, ios",
    exact: true,
  });
  await expect(ios.getByRole("img", { name: /50%/ })).toHaveCount(2);
  await expect(preview.getByRole("img", { name: /100%/ })).toHaveCount(1);

  await page.getByRole("tab", { name: "Cohorts", exact: true }).click();
  await page.getByRole("tab", { name: "Retention" }).click();
  const retention = page.getByRole("tabpanel", { name: "Retention" });
  await expect(retention.getByRole("cell", { name: /100%/ })).toBeVisible();
  await expect(retention.getByRole("cell", { name: /no data/i })).toHaveCount(
    4,
  );

  await page.getByRole("tab", { name: "Registry", exact: true }).click();
  const detailsButton = page.getByRole("button", {
    name: "Installation details " + id,
  });
  await detailsButton.click();
  const sheet = page.getByRole("dialog", { name: "Installation details" });
  await expect(sheet.getByText(id, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(detailsButton).toBeFocused();

  await page.getByLabel("Installation ID", { exact: true }).fill(randomUUID());
  await expect(
    page.getByText("No installations found", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await page
    .getByRole("button", { name: "Show daily values", exact: true })
    .click();
  await expect(daily.getByRole("row").last().getByRole("cell")).toHaveText([
    /./,
    "0",
    "0",
    "Partial day",
  ]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("Runtime", { exact: true })).toHaveValue("");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Interface language").selectOption("uk");
  for (const name of ["Огляд", "Версії", "Когорти", "Реєстр"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  }
  await page.getByLabel("Мова інтерфейсу").selectOption("en");
  if (viewport) await page.setViewportSize(viewport);
  console.log(
    "PASS browser installation filters/reset, missing vs zero vs partial coverage, scoped version shares, cohort maturity, registry focus and mobile Ukrainian tabs",
  );
}
