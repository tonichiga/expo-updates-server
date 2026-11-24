import { expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 30_000 });

export async function exerciseReleaseConsole(page, password) {
  const origin = new URL(page.url()).origin;
  const go = (path) => page.goto(origin + path);
  await go("/updates");
  const search = page.getByRole("searchbox", { name: "Search releases" });
  await search.fill("Candidate");
  await page
    .getByRole("combobox", { name: "All platforms" })
    .selectOption("ios");
  await page
    .getByRole("combobox", { name: "All channels" })
    .selectOption("production");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const release = page.getByRole("link", {
    name: "Candidate release",
    exact: true,
  });
  await expect(release).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Legacy public build", exact: true }),
  ).toHaveCount(0);
  await search.fill("no such release");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("No matching releases", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset", exact: true })
    .first()
    .click();
  await search.fill("Legacy public build");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const old = page.getByRole("link", {
    name: "Legacy public build",
    exact: true,
  });
  await expect(old).toBeVisible();
  await old.click();
  await page.getByRole("button", { name: "Rollback", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rollback", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Rollback" }).first(),
  ).toBeVisible();
  await go("/updates");
  await search.fill("Candidate release");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await release.click();
  await page.getByRole("button", { name: "Promote", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Promote", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Promote", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Policy", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Update policy" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Metadata", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "JSON editor" }),
  ).toBeVisible();
  const releasePath = new URL(page.url()).pathname;

  const viewer = await page.context().browser().newContext();
  try {
    const screen = await viewer.newPage();
    const login = await viewer.request.post(origin + "/api/admin/login", {
      data: { username: "viewer", password },
    });
    expect(login.status()).toBe(200);
    await screen.goto(origin + releasePath);
    await expect(screen.getByText("Read only", { exact: true })).toBeVisible();
    await expect(screen.getByRole("radio").first()).toBeDisabled();
    await expect(
      screen.getByRole("button", {
        name: /^(Activate|Deactivate|Promote|Rollback|Save audience)$/,
      }),
    ).toHaveCount(0);
    const denied = await viewer.request.post(
      origin + "/api/admin" + releasePath + "/deactivate",
      { data: { disabled: true } },
    );
    expect(denied.status()).toBe(403);
    await screen.getByRole("tab", { name: "Metadata" }).click();
    await expect(
      screen.getByRole("textbox", { name: "JSON editor" }),
    ).toHaveAttribute("readonly", "");
  } finally {
    await viewer.close();
  }
  console.log(
    "PASS release filters, no matches/reset, rollback/promotion, policy/metadata navigation and viewer UI/API denial",
  );
}
