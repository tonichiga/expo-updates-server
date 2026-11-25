import { seedPublication } from "./delivery.mjs";
import { expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 30_000 });

export async function exerciseReleaseConsole(page, password) {
  const origin = new URL(page.url()).origin;
  const go = (path) => page.goto(origin + path);
  await go("/updates");
  const search = page.getByRole("searchbox", { name: "Search releases" });
  await search.fill("Candidate");
  await page.getByRole("combobox", { name: "All platforms" }).click();
  await page.getByRole("option", { name: "iOS", exact: true }).click();
  await page.getByRole("combobox", { name: "All channels" }).click();
  await page.getByRole("option", { name: "production", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const release = page.getByRole("table").getByRole("link", {
    name: "Candidate release",
    exact: true,
  });
  await expect(release).toBeVisible();
  await expect(
    page
      .getByRole("table")
      .getByRole("link", { name: "Initial public build", exact: true }),
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
  await search.fill("Initial public build");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const old = page.getByRole("table").getByRole("link", {
    name: "Initial public build",
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

export async function exercisePublicRestore(page, { origin, db, storage }) {
  const scope = { channel: "restore-browser", runtime: "8.0" };
  const publish = (label) =>
    seedPublication(db, storage, label, false, "ios", scope);
  const setActive = async (release, active) => {
    const response = await page.request.post(
      origin + release.path + "/deactivate",
      { data: { disabled: !active } },
    );
    expect(response.status()).toBe(200);
  };
  const previous = await publish("Stable patch");
  await setActive(previous, true);
  const latest = await publish("Replacement patch");
  await setActive(latest, true);
  await setActive(latest, false);
  await page.goto(origin + "/updates");
  const search = page.getByRole("textbox", { name: "Find a delivery scope" });
  await search.fill(scope.channel);
  const row = page.getByRole("region", {
    name: "restore-browser / ios / 8.0",
    exact: true,
  });
  await expect(row.getByText("No active release")).toBeVisible();
  await expect(row.getByRole("link", { name: previous.comment })).toBeVisible();
  const restore = row.getByRole("button", { name: "Restore", exact: true });
  await page.getByRole("button", { name: "Management", exact: true }).click();
  await page.getByRole("button", { name: "Stop all OTA", exact: true }).click();
  await expect(
    page.getByText("Enter a reason for the emergency stop.", { exact: true }),
  ).toBeVisible();
  await expect(restore).toBeEnabled();
  await restore.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row.getByText("No active release")).toBeVisible();
  await restore.click();
  await dialog
    .getByRole("button", { name: "Restore release", exact: true })
    .click();
  await expect(row.getByRole("link", { name: latest.comment })).toBeVisible();
  await expect(row.getByText("No active release")).toHaveCount(0);
  console.log(
    "PASS manual public restore, confirmation cancellation and refreshed release history",
  );
}
