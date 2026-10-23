// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtaController } from "../../templates/expo-app/ota-client/types";
import { OtaUpdates } from "../../templates/expo-app/ota-client/ui/ota-updates";

const mocked = vi.hoisted(() => ({ hook: vi.fn() }));
vi.mock(
  "../../templates/expo-app/ota-client/model/hooks/useOtaUpdates",
  () => ({ useOtaUpdates: mocked.hook }),
);

let root: Root;
let container: HTMLDivElement;
let controller: OtaController;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  controller = {
    enabled: true,
    status: "idle",
    installationId: "installation",
    deviceId: "device",
    available: true,
    pending: false,
    candidate: { type: "new", manifest: { id: "a" } },
    policy: { schemaVersion: 1, delivery: "manual" },
    blocked: false,
    blockReason: null,
    error: null,
    isBusy: false,
    check: vi.fn(async () => ({ isAvailable: true })),
    download: vi.fn(async () => ({ isNew: true })),
    reload: vi.fn(async () => {}),
    retry: vi.fn(async () => ({ isAvailable: true })),
    openStore: vi.fn(async () => {}),
  };
  mocked.hook.mockImplementation(() => controller);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <>
        <div>Application tabs</div>
        <OtaUpdates />
      </>,
    ),
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
describe("standalone OTA updates UI", () => {
  it("offers manual download with autoUpdate false, then restart, without wrapping navigation", async () => {
    await render();
    expect(mocked.hook).toHaveBeenCalledWith(
      expect.objectContaining({
        autoCheck: true,
        autoUpdate: false,
        autoReload: false,
      }),
    );
    expect(container.textContent).toContain("Update available");
    expect(container.querySelector("[role=dialog]")?.textContent).not.toContain(
      "Application tabs",
    );
    await click("Download");
    expect(controller.download).toHaveBeenCalledOnce();
    controller = { ...controller, pending: true };
    await render();
    await click("Restart");
    expect(controller.reload).toHaveBeenCalledOnce();
  });
  it("dismisses an optional candidate until another candidate arrives", async () => {
    await render();
    await click("Later");
    expect(container.querySelector("[role=dialog]")).toBeNull();
    await render();
    expect(container.querySelector("[role=dialog]")).toBeNull();
    controller = {
      ...controller,
      candidate: { type: "new", manifest: { id: "b" } },
    };
    await render();
    expect(container.querySelector("[role=dialog]")).not.toBeNull();
  });
  it("keeps background updates silent, even after download", async () => {
    controller = {
      ...controller,
      pending: true,
      policy: { schemaVersion: 1, delivery: "background" },
    };
    await render();
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });
  it("does not allow dismissing required updates, even for a previously dismissed candidate", async () => {
    await render();
    await click("Later");
    controller = {
      ...controller,
      blocked: true,
      blockReason: "ota-force-update",
      pending: true,
    };
    await render();
    expect(container.textContent).toContain("Update required");
    expect(container.textContent).not.toContain("Later");
    await act(async () =>
      container
        .querySelector("[role=dialog]")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(container.querySelector("[role=dialog]")).not.toBeNull();
    await click("Restart");
    expect(controller.reload).toHaveBeenCalledOnce();
  });
  it("routes store guards to the store instead of download", async () => {
    controller = {
      ...controller,
      blocked: true,
      blockReason: "ota-force-store-update",
    };
    await render();
    await click("Open store");
    expect(controller.openStore).toHaveBeenCalledOnce();
    expect(controller.download).not.toHaveBeenCalled();
  });
  it("leaves unknown guards blocked and disables operations while busy", async () => {
    controller = {
      ...controller,
      blocked: true,
      blockReason: "custom",
      isBusy: true,
    };
    await render();
    expect(container.textContent).toContain("Update needs attention");
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.textContent).not.toContain("Later");
  });
});
