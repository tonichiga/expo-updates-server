import path from "node:path";
import { mkdir } from "node:fs/promises";
import { exerciseReleaseConsole } from "./releases.mjs";
import { exerciseInstallations } from "./installations.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

export async function exerciseConsole({ origin, password }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/updates");
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[autocomplete="username"]').fill("admin");
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/updates$/);
    await exerciseReleaseConsole(page, password);
    await page.goto(origin + "/updates/embedded");
    await expect(page.getByText("beta", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeFocused();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "/updates",
        "/updates/devices",
        "/updates/embedded",
        "/updates/emergency-redirects",
      ]) {
        await page.goto(origin + route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth - window.innerWidth,
            ),
          )
          .toBeLessThanOrEqual(1);
      }
    }
    await exerciseInstallations(page);
    if (process.env.OTA_E2E_ARTIFACTS) {
      const output = process.env.OTA_E2E_ARTIFACTS;
      await mkdir(output, { recursive: true });
      await page.evaluate(() =>
        localStorage.setItem("ota-console-theme", "dark"),
      );
      await page.getByLabel("Interface language").selectOption("ru");
      for (const [route, name] of [
        ["/updates", "releases"],
        ["/updates/devices", "installations"],
      ]) {
        await page.goto(origin + route);
        await page.waitForLoadState("networkidle");
        await page.screenshot({
          style: "nextjs-portal { display:none; }",
          path: path.join(output, name + ".png"),
        });
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser login, release navigation, embedded deletion cancellation and focus, desktop/mobile layouts",
    );
  } finally {
    await browser.close();
  }
}
