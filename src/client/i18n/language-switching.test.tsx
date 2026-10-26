// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "@/components/admin/language-switcher";
import EmergencyRedirectsPage from "@/app/updates/emergency-redirects/page";
import UpdatePolicyEditor from "@/src/client/update-policy-editor";
import LoginPage from "@/app/login/page";
import { LocaleProvider, useI18n } from "./provider";
import { useFormatters } from "./use-formatters";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./messages";

const api = vi.hoisted(() => ({
  getEmergencyRedirects: vi.fn(),
  getAdminSession: vi.fn(),
  createEmergencyRedirect: vi.fn(),
  updateEmergencyRedirect: vi.fn(),
  deleteEmergencyRedirect: vi.fn(),
  getUpdatePolicy: vi.fn(),
  getGuardActions: vi.fn(),
  putUpdatePolicy: vi.fn(),
  createGuardAction: vi.fn(),
  deleteGuardAction: vi.fn(),
  adminLogin: vi.fn(),
}));
vi.mock("@/src/client/admin-api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

let root: Root;
let container: HTMLDivElement;
const redirect = {
  id: "rule-1",
  name: "Мой канал / $&",
  enabled: true,
  embeddedUpdateId: "11111111-1111-4111-8111-111111111111",
  runtimeVersion: "1.0.0",
  platform: "android",
  fromChannel: "development",
  toChannel: "production",
  targetMode: "pinned",
  expectedUpdateId: "22222222-2222-4222-8222-222222222222",
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`;
  api.getEmergencyRedirects.mockResolvedValue({ items: [redirect] });
  api.getAdminSession.mockResolvedValue({ role: "admin" });
  api.updateEmergencyRedirect.mockResolvedValue(redirect);
  api.getUpdatePolicy.mockResolvedValue({
    delivery: "manual",
    guard: null,
    policyVersion: 1,
    editable: true,
    publishedAt: null,
  });
  api.getGuardActions.mockResolvedValue({ items: [], canWrite: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
async function switchTo(locale: Locale) {
  const select = container.querySelector<HTMLSelectElement>(
    "select[aria-label]",
  )!;
  await act(async () => {
    select.value = locale;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
function Formats() {
  const { formatLocale } = useI18n();
  const { number, fullDate } = useFormatters();
  return (
    <output data-locale={formatLocale}>
      {number(12345.6)} | {fullDate("2026-10-26T12:34:00Z")}
    </output>
  );
}

describe("language switching", () => {
  it("switches recovery forms, status, notices and accessibility labels without losing data", async () => {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="en">
          <LanguageSwitcher />
          <EmergencyRedirectsPage />
        </LocaleProvider>,
      ),
    );
    expect(container.textContent).toContain("Emergency redirects");
    await click("Edit");
    await switchTo("ru");
    expect(container.textContent).toContain("Исходный канал");
    expect(container.textContent).toContain("Закреплённое обновление");
    expect(
      container
        .querySelector("select[aria-label]")
        ?.getAttribute("aria-label"),
    ).toBe("Язык интерфейса");
    expect(
      [...container.querySelectorAll("input")].map((i) => i.value),
    ).toContain(redirect.name);
    await click("Сохранить изменения");
    expect(api.updateEmergencyRedirect).toHaveBeenCalledWith(
      "rule-1",
      expect.objectContaining({
        name: redirect.name,
        fromChannel: "development",
        toChannel: "production",
        targetMode: "pinned",
      }),
    );
    expect(container.textContent).toContain("Аварийный маршрут обновлён");
    await switchTo("uk");
    expect(container.textContent).toContain("Аварійний маршрут оновлено");
    expect(container.textContent).toContain("Початковий канал");
    expect(container.textContent).toContain("Увімкнено");
    expect(container.textContent).toContain(redirect.name);
    expect(document.documentElement.lang).toBe("uk");
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=uk`);
    expect(api.getEmergencyRedirects).toHaveBeenCalledTimes(2);
    await switchTo("en");
    expect(container.textContent).toContain("Emergency redirect updated");
  });

  it("localizes recovery validation errors and read-only actions", async () => {
    api.getAdminSession.mockResolvedValue({ role: "viewer" });
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="uk">
          <LanguageSwitcher />
          <EmergencyRedirectsPage />
        </LocaleProvider>,
      ),
    );
    expect(container.textContent).toContain("Лише читання");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Read only");
  });

  it("renders login and formatting in the saved locale on remount and on the server", async () => {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="en">
          <LanguageSwitcher />
          <Formats />
        </LocaleProvider>,
      ),
    );
    await switchTo("uk");
    expect(container.querySelector("output")?.dataset.locale).toBe("uk-UA");
    expect(container.querySelector("output")?.textContent).toContain(
      new Intl.NumberFormat("uk-UA").format(12345.6),
    );
    expect(container.querySelector("output")?.textContent).toContain(
      new Intl.DateTimeFormat("uk-UA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date("2026-10-26T12:34:00Z")),
    );
    const saved = resolveLocale(document.cookie.split("=")[1]);
    await act(async () =>
      root.render(
        <LocaleProvider key="reload" initialLocale={saved}>
          <LoginPage />
        </LocaleProvider>,
      ),
    );
    expect(container.textContent).toContain("Увійти");
    expect(container.querySelector("select")?.value).toBe("uk");
    const html = renderToString(
      <LocaleProvider initialLocale={saved}>
        <LanguageSwitcher />
      </LocaleProvider>,
    );
    expect(html).toContain('aria-label="Мова інтерфейсу"');
    expect(html).toContain('value="uk" lang="uk" selected=""');
  });

  it("switches the policy editor, catalog, and errors in place", async () => {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="ru">
          <LanguageSwitcher />
          <UpdatePolicyEditor encodedKey="test" onSaved={async () => {}} />
        </LocaleProvider>,
      ),
    );
    expect(container.textContent).toContain("Политика обновления");
    expect(container.textContent).toContain("Каталог действий");
    await switchTo("uk");
    expect(container.textContent).toContain("Політика оновлення");
    expect(container.textContent).toContain("Додати дію до каталогу");
    api.putUpdatePolicy.mockRejectedValue(
      new Error("Update policy is immutable after publication."),
    );
    await click("Зберегти політику");
    expect(container.textContent).toContain(
      "Політику оновлення не можна змінити після публікації.",
    );
    await switchTo("ru");
    expect(container.textContent).toContain(
      "Политику обновления нельзя изменить после публикации.",
    );
  });
});
