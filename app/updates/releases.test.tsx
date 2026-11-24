// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRoleContext } from "@/components/admin/admin-role";
import UpdatesPage from "./page";
import UpdateDetailsPage from "./[encodedKey]/page";

const api = vi.hoisted(() => ({ getUpdates: vi.fn(), getUpdate: vi.fn() }));
vi.mock("@/src/client/admin-api", () => api);
vi.mock("next/navigation", () => ({
  useParams: () => ({ encodedKey: "draft" }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/src/client/update-policy-editor", () => ({ default: () => null }));
vi.mock("@/src/client/distribution-control", () => ({
  default: () => null,
  DistributionControlBanner: () => null,
  useDistributionControlState: () => ({
    loading: false,
    error: "",
    state: { blocked: false },
  }),
}));

const draft = {
  key: "draft",
  encodedKey: "draft",
  updateId: "878b4c0b-7ef8-45db-9726-63c3418cfea7",
  comment: "First iOS release",
  runtimeVersion: "1.0",
  platform: "ios",
  channel: "preview",
  status: "disabled",
  isNewestInScope: true,
  channelLatest: null,
  policyEditable: true,
  audienceMode: "all",
  policyVersion: 1,
  createdAt: "2026-11-20T12:00:00Z",
};
const result = {
  items: [draft],
  total: 1,
  page: 1,
  totalPages: 1,
  filters: { channels: ["preview"], runtimes: ["1.0"] },
  rollbackLockByScope: [],
};
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  api.getUpdates.mockResolvedValue(result);
  api.getUpdate.mockResolvedValue(draft);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            audience_mode: "all",
            audience_installation_ids: [],
            audience_device_ids: [],
            audience_version: 1,
          }),
        ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("release workflows", () => {
  it("applies filters to the API, retains the last history on error and resets empty results", async () => {
    await act(async () => root.render(<UpdatesPage />));
    expect(host.textContent).toContain(draft.comment);
    const select = host.querySelector<HTMLSelectElement>(
      'select[aria-label="All channels"]',
    )!;
    await act(async () => {
      select.value = "preview";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const form = host.querySelector("form")!;
    api.getUpdates.mockRejectedValueOnce(new Error("Temporary outage"));
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(api.getUpdates).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, channel: "preview" }),
      expect.any(AbortSignal),
    );
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "Showing the previous results.",
    );
    expect(host.textContent).toContain(draft.comment);
    api.getUpdates.mockResolvedValueOnce({ ...result, items: [], total: 0 });
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[role=alert] button")!.click(),
    );
    expect(host.textContent).toContain("No matching releases");
    const reset = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Reset",
    )!;
    await act(async () => reset.click());
    expect(api.getUpdates).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, channel: "" }),
      expect.any(AbortSignal),
    );
    expect(host.textContent).toContain(draft.comment);
  });

  it("exposes first-draft activation before a channel pointer exists and keeps viewer controls read-only", async () => {
    const render = (role: string) =>
      root.render(
        <AdminRoleContext.Provider value={role}>
          <UpdateDetailsPage />
        </AdminRoleContext.Provider>,
      );
    await act(async () => render("operator"));
    const buttons = () =>
      [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons()).toContain("Activate");
    expect(buttons()).toContain("Save audience");
    expect(
      host.querySelector("[role=tab][aria-selected=true]")?.textContent,
    ).toBe("Audience");
    expect(host.querySelector('textarea[aria-label="JSON editor"]')).toBeNull();

    await act(async () => render("viewer"));
    expect(buttons()).not.toContain("Activate");
    expect(buttons()).not.toContain("Save audience");
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
  });
});
