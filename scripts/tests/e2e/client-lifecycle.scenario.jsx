import { createHash, verify } from "node:crypto";
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdateController } from "../../../templates/expo-app/ota-client/model/update-controller";
import { OtaUpdateOverlay } from "../../../templates/expo-app/ota-client/ui/ota-updates";

vi.mock(
  "../../../templates/expo-app/ota-client/model/hooks/useOtaUpdates",
  () => ({
    useOtaUpdates: () => {
      throw new Error("Use the injected native bridge");
    },
  }),
);

const { origin, publicKey, cookie, platforms } = JSON.parse(
  process.env.OTA_LIFECYCLE_FIXTURE,
);
expect(new URL(origin).hostname).toBe("127.0.0.1");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function admin(path, method = "GET", body) {
  const res = await fetch(origin + path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  expect(res.status, JSON.stringify(data)).toBe(200);
  return data;
}
async function stop(blocked) {
  const path = "/api/admin/distribution-control";
  const current = await admin(path);
  if (blocked !== current.blocked)
    await admin(path, "PUT", {
      blocked,
      expectedVersion: current.version,
      reason: blocked ? "Local client rehearsal" : undefined,
    });
}

// This bridge substitutes for expo-updates storage, native reload, connectivity and store handoff.
// Network selection, signature verification, real asset bytes, the client controller and the overlay all run.
function device(platform, channel, runtime = "1.0.0") {
  const state = {
    online: true,
    failAsset: false,
    running: null,
    cached: null,
    pending: null,
    checks: 0,
    downloads: 0,
    requests: 0,
    reloads: 0,
    store: null,
    now: 0,
  };
  async function network(url, init) {
    if (!state.online) throw new Error("Offline");
    expect(new URL(url).origin).toBe(origin);
    state.requests++;
    return fetch(url, init);
  }
  async function manifest() {
    const response = await network(origin + "/api/manifest", {
      headers: {
        "expo-platform": platform,
        "expo-runtime-version": runtime,
        "expo-channel-name": channel,
        "expo-protocol-version": "1",
        "expo-expect-signature": "sig, keyid=main",
        ...(state.running
          ? { "expo-current-update-id": state.running.id }
          : {}),
      },
    });
    expect(response.status).toBe(200);
    const boundary = response.headers
      .get("content-type")
      .match(/boundary="?([^";]+)/)[1];
    const raw = await response.text();
    const part = raw
      .split("--" + boundary)
      .find((p) => /name="(?:manifest|directive)"/i.test(p));
    const [headers, body] = part.trim().split("\r\n\r\n");
    const sig = headers.match(/expo-signature: sig="([^"]+)"/i)[1];
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(body),
        publicKey,
        Buffer.from(sig, "base64"),
      ),
    ).toBe(true);
    const value = JSON.parse(body);
    return value.type === "noUpdateAvailable" ? null : value;
  }
  function launchCached() {
    if (!state.cached) throw new Error("No cached bundle");
    state.running = state.cached.manifest;
    state.pending = null;
  }
  function launch() {
    const controller = createUpdateController({
      enabled: true,
      start() {},
      identity: async () => ({ installationId: null, deviceId: null }),
      now: () => state.now,
      isActive: () => true,
      runningCandidate: () =>
        state.running && { type: "new", manifest: state.running },
      check: async () => {
        state.checks++;
        const value = await manifest();
        return { isAvailable: Boolean(value), manifest: value };
      },
      fetch: async () => {
        state.downloads++;
        const value = await manifest();
        if (!value) return { isNew: false };
        const buffers = [];
        for (const asset of [value.launchAsset, ...value.assets]) {
          if (state.failAsset)
            throw new Error("Connection lost during download");
          const response = await network(asset.url);
          if (!response.ok)
            throw new Error("Asset request failed " + response.status);
          const bytes = Buffer.from(await response.arrayBuffer());
          expect(createHash("sha256").update(bytes).digest("base64url")).toBe(
            asset.hash,
          );
          buffers.push(bytes);
        }
        state.cached = { manifest: value, buffers };
        state.pending = { type: "new", manifest: value };
        return { isNew: true, manifest: value };
      },
      reload: async () => {
        state.reloads++;
        launchCached();
      },
      openStore: async (payload) => {
        state.store = payload;
      },
    });
    controller.configure(Symbol("app"), {
      autoCheck: true,
      autoUpdate: false,
      autoReload: false,
    });
    return controller;
  }
  return { launch, launchCached, state };
}

function Screen({ model }) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot);
  return (
    <OtaUpdateOverlay
      controller={{ ...model, ...snapshot, isBusy: snapshot.status !== "idle" }}
    />
  );
}
let root;
let host;
async function screen(model) {
  if (root) await act(async () => root.unmount());
  host?.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Screen model={model} />));
}
const text = () => host.textContent;
const press = async (label, model) => {
  const element = [...host.querySelectorAll("button")].find(
    (el) => el.textContent === label,
  );
  expect(element, label).toBeDefined();
  await act(async () => {
    element.click();
    await vi.waitFor(() => expect(model.getSnapshot().status).toBe("idle"));
  });
};
async function check(model) {
  await act(async () => {
    await model.check();
  });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  host?.remove();
  await stop(false);
});

describe.each(["ios", "android"])(
  "%s signed HTTP delivery and client overlay",
  (platform) => {
    const scopes = platforms[platform];
    it("offers manual downloads, dismisses until remount, retries and restarts cached bytes offline", async () => {
      const phone = device(platform, scopes.manual.channel);
      const app = phone.launch();
      await screen(app);
      await act(async () => {
        app.automaticCheck();
        await vi.waitFor(() => expect(app.getSnapshot().status).toBe("idle"));
      });
      expect(phone.state.checks).toBe(1);
      expect(phone.state.downloads).toBe(0);
      expect(text()).toContain("Update available");
      await press("Later", app);
      await check(app);
      expect(host.querySelector("[role=dialog]")).toBeNull();
      await screen(app);
      expect(text()).toContain("Download");
      phone.state.failAsset = true;
      await press("Download", app);
      expect(text()).toContain("Connection lost");
      expect(phone.state.cached).toBeNull();
      phone.state.failAsset = false;
      await press("Download", app);
      expect(phone.state.cached.buffers.length).toBe(2);
      expect(phone.state.running).toBeNull();
      const restored = phone.launch();
      await screen(restored);
      await act(async () => {
        await restored.syncPending(phone.state.pending);
      });
      expect(text()).toContain("Restart");
      await stop(true);
      phone.state.online = false;
      const requests = phone.state.requests;
      await press("Restart", restored);
      expect(phone.state.requests).toBe(requests);
      expect(phone.state.running.id).toBe(phone.state.cached.manifest.id);
      const reopened = phone.launch();
      await screen(reopened);
      await act(async () => {
        await expect(reopened.check()).rejects.toThrow("Offline");
      });
      expect(host.querySelector("[role=dialog]")).toBeNull();
      phone.state.online = true;
      await check(reopened);
      expect(phone.state.running.id).toBe(phone.state.cached.manifest.id);
      await stop(false);
      await check(reopened);
      expect(reopened.getSnapshot().available).toBe(false);
      const incompatible = device(
        platform,
        scopes.manual.channel,
        "unpublished",
      ).launch();
      await screen(incompatible);
      await check(incompatible);
      expect(incompatible.getSnapshot().available).toBe(false);
      expect(text()).toBe("");
    });

    it("keeps background delivery silent, prevents a fresh download during a stop, and retains a cached candidate", async () => {
      const phone = device(platform, scopes.background.channel);
      const app = phone.launch();
      await screen(app);
      await stop(true);
      await check(app);
      expect(phone.state.downloads).toBe(0);
      expect(text()).toBe("");
      await stop(false);
      await check(app);
      expect(app.getSnapshot().pending).toBe(true);
      expect(phone.state.downloads).toBe(1);
      expect(phone.state.reloads).toBe(0);
      expect(text()).toBe("");
      await stop(true);
      await check(app);
      expect(app.getSnapshot().pending).toBe(true);
      expect(phone.state.downloads).toBe(1);
      expect(
        (await fetch(phone.state.cached.manifest.launchAsset.url)).status,
      ).toBe(503);
      phone.launchCached();
      const launched = phone.launch();
      await screen(launched);
      await check(launched);
      expect(text()).toBe("");
      expect(phone.state.running.id).toBe(phone.state.cached.manifest.id);
    });

    it("checks required Guard behavior before download, across a failed fetch, a stop and a replacement", async () => {
      const phone = device(platform, scopes.required.channel);
      const app = phone.launch();
      phone.state.failAsset = true;
      await screen(app);
      await act(async () => {
        await expect(app.check()).rejects.toThrow("Connection lost");
      });
      expect(text()).toContain("Update required");
      expect(text()).not.toContain("Later");
      await act(async () => {
        host
          .querySelector("[role=dialog]")
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
      });
      expect(text()).toContain("Retry");
      const reopened = phone.launch();
      await screen(reopened);
      await act(async () => {
        await expect(reopened.check()).rejects.toThrow("Connection lost");
      });
      expect(text()).toContain("Update required");
      await stop(true);
      await press("Retry", reopened);
      expect(reopened.getSnapshot().blocked).toBe(false);
      await stop(false);
      phone.state.failAsset = false;
      await check(reopened);
      expect(text()).toContain("Restart");
      await stop(true);
      await check(reopened);
      expect(reopened.getSnapshot().blocked).toBe(true);
      expect(reopened.getSnapshot().pending).toBe(true);
      await stop(false);
      const waitingPhone = device(platform, scopes.required.channel);
      waitingPhone.state.failAsset = true;
      const waiting = waitingPhone.launch();
      await expect(waiting.check()).rejects.toThrow("Connection lost");
      expect(waiting.getSnapshot().blockReason).toBe("ota-force-update");
      await admin(scopes.required.replacement + "/deactivate", "POST", {
        disabled: false,
      });
      await waiting.retry();
      expect(waiting.getSnapshot().blocked).toBe(false);
      expect(waiting.getSnapshot().pending).toBe(false);
      await check(reopened);
      expect(reopened.getSnapshot().blockReason).toBe("ota-force-update");
      await press("Restart", reopened);
      const fulfilled = phone.launch();
      await screen(fulfilled);
      await act(async () => {
        await fulfilled.initialize();
      });
      expect(fulfilled.getSnapshot().blocked).toBe(false);
      await check(fulfilled);
      expect(text()).toContain("Update available");
      expect(text()).not.toContain("Update required");
    });

    it("keeps the store Guard separate from OTA and observes replacement on explicit retry", async () => {
      const phone = device(platform, scopes.store.channel);
      const app = phone.launch();
      await screen(app);
      await check(app);
      expect(text()).toContain("Open store");
      expect(text()).not.toContain("Download");
      await press("Open store", app);
      expect(phone.state.store.url).toBe("https://example.invalid/store");
      expect(phone.state.downloads).toBe(0);
      await admin(scopes.store.replacement + "/deactivate", "POST", {
        disabled: false,
      });
      phone.state.now += 180000;
      expect(phone.state.checks).toBe(1);
      expect(text()).toContain("Open store");
      await press("Check again", app);
      expect(app.getSnapshot().blocked).toBe(false);
      expect(text()).toContain("Update available");
      // Stopping a public replacement must not silently reinstate its store Guard.
      await admin(scopes.store.replacement + "/deactivate", "POST", { disabled: true });
      await check(app);
      expect(app.getSnapshot().available).toBe(false);
      expect(app.getSnapshot().blocked).toBe(false);
      const { scopes: history } = await admin("/api/admin/distribution-history");
      const stopped = history.find((s) => s.channel === scopes.store.channel && s.platform === platform);
      expect(stopped.current).toBeNull();
      await admin("/api/admin/distribution-history/restore", "POST", {
        updateId: stopped.previous.updateId, expectedRevision: stopped.revision,
      });
      await check(app);
      expect(text()).toContain("Open store");

    });
  },
);
