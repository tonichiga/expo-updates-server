import { manifestDetails } from "../types";
import type {
  OtaCandidate,
  OtaCheckResult,
  OtaFetchResult,
  OtaOptions,
  OtaState,
} from "../types";

interface Dependencies {
  enabled: boolean;
  start(): void;
  identity(): Promise<{
    installationId: string | null;
    deviceId: string | null;
  }>;
  check(): Promise<OtaCheckResult>;
  fetch(): Promise<OtaFetchResult>;
  reload(): Promise<void>;
  isActive(): boolean;
  openStore(payload: unknown): Promise<void>;
  runningCandidate?(): OtaCandidate | null;
  now?(): number;
}

// Pure lifecycle model. Native APIs, storage and React live in adapters.
export function createUpdateController(deps: Dependencies) {
  let state: Readonly<OtaState> = Object.freeze({
    enabled: deps.enabled,
    status: "idle",
    installationId: null,
    deviceId: null,
    available: false,
    pending: false,
    candidate: null,
    policy: null,
    blocked: false,
    blockReason: null,
    error: null,
  });
  const listeners = new Set<() => void>();
  const owners = new Map<symbol, OtaOptions>();
  let flight: Promise<unknown> | undefined;
  let flightKind: OtaState["status"] | undefined;
  let lastAutomaticCheck = -Infinity;
  let identityReady: Promise<void> | undefined;
  let pendingKey: string | undefined;
  let pendingGeneration = 0;
  const now = deps.now || Date.now;
  function patch(value: Partial<OtaState>) {
    state = Object.freeze({ ...state, ...value });
    for (const listener of listeners) listener();
  }
  function options() {
    const result: Required<OtaOptions> = {
      autoCheck: false,
      autoUpdate: false,
      autoReload: false,
      guardHandlers: {},
    };
    for (const owner of owners.values()) {
      for (const key of ["autoCheck", "autoUpdate", "autoReload"] as const)
        result[key] ||= owner[key] === true;
      Object.assign(result.guardHandlers, owner.guardHandlers);
    }
    return result;
  }
  function initialize() {
    deps.start();
    if (!deps.enabled) return Promise.resolve();
    if (!identityReady)
      identityReady = deps
        .identity()
        .then(async (identity) => {
          patch(identity);
          await inspectRunning();
        })
        .catch((error) => {
          identityReady = undefined;
          patch({ error });
          throw error;
        });
    return identityReady;
  }
  function run<T>(
    kind: OtaState["status"],
    task: () => Promise<T>,
  ): Promise<T> {
    if (!deps.enabled)
      return Promise.reject(
        new Error("OTA updates are unavailable in this build"),
      );
    if (flight) {
      if (flightKind === kind) return flight as Promise<T>;
      return Promise.reject(new Error("Another OTA operation is in progress"));
    }
    flightKind = kind;
    patch({ status: kind, error: null });
    const operation = Promise.resolve()
      .then(initialize)
      .then(task)
      .catch((error) => {
        patch({ error });
        throw error;
      })
      .finally(() => {
        flight = undefined;
        flightKind = undefined;
        patch({ status: "idle" });
      });
    flight = operation;
    return operation;
  }
  async function inspect(candidate: OtaCandidate | null) {
    const policy =
      manifestDetails(candidate?.manifest)?.extra?.updatePolicy ?? null;
    patch({ candidate, policy, blocked: false, blockReason: null });
    if (!policy) return;
    if (
      policy.schemaVersion !== 1 ||
      !["manual", "background"].includes(policy.delivery)
    ) {
      patch({ blocked: true, blockReason: "unsupported-policy" });
      return;
    }
    const guard = policy.guard;
    if (!guard) return;
    // Fail closed while an asynchronous application guard is being evaluated.
    patch({ blocked: true, blockReason: guard.action || "unsupported-policy" });
    if (
      guard.action === "ota-force-update" ||
      guard.action === "ota-force-store-update"
    )
      return;
    const handler = options().guardHandlers[guard.action];
    if (!handler) return;
    const decision = await handler({
      action: guard.action,
      payload: guard.payload,
      manifest: candidate?.manifest,
    });
    if (decision === "allow") patch({ blocked: false, blockReason: null });
  }
  async function inspectRunning() {
    const running = deps.runningCandidate?.();
    // Force OTA is fulfilled by launching it. Store/custom guards still apply
    // after a native cold start, including a bundle fetched during a release race.
    if (
      manifestDetails(running?.manifest)?.extra?.updatePolicy?.guard?.action ===
      "ota-force-update"
    )
      return inspect(null);
    return inspect(running || null);
  }
  function canDownload() {
    return !state.blocked || state.blockReason === "ota-force-update";
  }
  async function downloadInternal() {
    if (!state.available && !state.pending)
      throw new Error("Check for an update before downloading");
    if (!canDownload()) throw new Error("Update is blocked by its guard");
    patch({ status: "downloading" });
    const result = await deps.fetch();
    if (result.isNew || result.isRollBackToEmbedded) {
      const candidate = target(result);
      pendingKey = key(candidate);
      pendingGeneration += 1;
      // Fetch performs another manifest request: its policy can differ from check's.
      patch({ pending: true, available: true });
      await inspect(candidate);
    }
    return result;
  }
  async function reloadInternal() {
    if (!state.pending) throw new Error("No downloaded update is ready");
    if (!canDownload()) throw new Error("Update is blocked by its guard");
    if (!deps.isActive())
      throw new Error("Reload is only allowed while the app is active");
    patch({ status: "reloading" });
    return deps.reload();
  }
  async function automate(allowDownload = true) {
    const settings = options();
    if (
      allowDownload &&
      !state.pending &&
      state.available &&
      canDownload() &&
      (settings.autoUpdate ||
        state.policy?.delivery === "background" ||
        state.blockReason === "ota-force-update")
    ) {
      await downloadInternal();
    }
    // A background policy always wins over autoReload. Guards are re-evaluated after fetch.
    if (
      state.pending &&
      canDownload() &&
      settings.autoReload &&
      state.policy?.delivery !== "background" &&
      deps.isActive()
    )
      await reloadInternal();
  }
  function check() {
    return run("checking", async () => {
      const result = await deps.check();
      if (result.isAvailable || result.isRollBackToEmbedded) {
        patch({ available: true });
        // Never replace the policy governing an already downloaded bundle with a different candidate.
        if (!state.pending) await inspect(target(result));
      } else if (!state.pending) {
        patch({ available: false });
        await inspectRunning();
      }
      if (state.pending) await inspect(state.candidate);
      await automate();
      return result;
    });
  }
  function automaticCheck() {
    if (
      !deps.enabled ||
      !options().autoCheck ||
      !deps.isActive() ||
      flight ||
      now() - lastAutomaticCheck < 60000
    )
      return;
    lastAutomaticCheck = now();
    void check().catch(() => undefined);
  }
  const api = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize,
    configure(owner: symbol, value: OtaOptions) {
      owners.set(owner, value);
    },
    removeOwner(owner: symbol) {
      owners.delete(owner);
    },
    automaticCheck,
    check,
    download: () =>
      run("downloading", async () => {
        const result = await downloadInternal();
        await automate(false);
        return result;
      }),
    reload: () => run("reloading", reloadInternal),
    retry: () => check(),
    openStore: () =>
      run("opening-store", async () => {
        if (state.blockReason !== "ota-force-store-update")
          throw new Error("No store upgrade is required");
        await deps.openStore(state.policy?.guard?.payload);
      }),
    syncPending(candidate: OtaCandidate | null): Promise<void> {
      if (!candidate || key(candidate) === pendingKey) return Promise.resolve();
      if (flight) {
        const observedGeneration = pendingGeneration;
        return flight
          .catch(() => undefined)
          .then(() => {
            if (pendingGeneration === observedGeneration)
              return api.syncPending(candidate);
          });
      }
      return run("checking", async () => {
        pendingKey = key(candidate);
        pendingGeneration += 1;
        patch({ pending: true, available: true });
        await inspect(candidate);
        // Synchronizing native state never implicitly reloads a restored bundle.
      });
    },
  };
  return api;
}

function target(result: OtaCheckResult | OtaFetchResult): OtaCandidate {
  if (result.isRollBackToEmbedded) return { type: "rollback", manifest: null };
  return { type: "new", manifest: result.manifest };
}
function key(candidate: OtaCandidate) {
  return candidate.type === "rollback"
    ? "rollback"
    : manifestDetails(candidate.manifest)?.id;
}
