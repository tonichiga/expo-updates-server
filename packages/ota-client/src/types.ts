import type { ReactNode } from "react";

type MaybePromise<T> = T | Promise<T>;

export interface OtaClientAdapter {
  storage: {
    getItem(key: string): MaybePromise<string | null>;
    setItem(key: string, value: string): MaybePromise<void>;
    removeItem(key: string): MaybePromise<void>;
  };
  randomUUID(): string;
  /** Lowercase SHA-256 hex digest of the UTF-8 string. */
  sha256(value: string): MaybePromise<string>;
}

export interface OtaClientConfig {
  channel: string;
  heartbeatUrl: string;
  /** Keep stable across server URL and channel changes to preserve device identity. */
  identityNamespace: string;
}

export interface OtaPolicy {
  schemaVersion: number;
  delivery: "manual" | "background";
  onPostpone?: "download";
  guard?: { action: string; payload?: unknown };
}

export interface OtaManifest {
  id?: string;
  extra?: { updatePolicy?: OtaPolicy };
  metadata?: { channel?: string };
}

export interface OtaCandidate {
  type: "new" | "rollback";
  manifest: unknown;
}

export interface OtaCheckResult {
  isAvailable: boolean;
  isRollBackToEmbedded?: boolean;
  manifest?: unknown;
}

export interface OtaFetchResult {
  isNew: boolean;
  isRollBackToEmbedded?: boolean;
  manifest?: unknown;
}

export interface OtaOptions {
  /** Check on mount/foreground, at most once per minute. Default false in the hook. */
  autoCheck?: boolean;
  /** Download ordinary releases automatically; does not control their visibility. */
  autoUpdate?: boolean;
  /** Reload eligible manual updates. Required background updates reload independently. */
  autoReload?: boolean;
  guardHandlers?: Record<
    string,
    (context: {
      action: string;
      payload: unknown;
      manifest: unknown;
    }) => "allow" | "block" | Promise<"allow" | "block">
  >;
}

export interface OtaState {
  enabled: boolean;
  status: "idle" | "checking" | "downloading" | "reloading" | "opening-store";
  installationId: string | null;
  deviceId: string | null;
  postponedUpdateId: string | null;
  available: boolean;
  pending: boolean;
  candidate: OtaCandidate | null;
  policy: OtaPolicy | null;
  blocked: boolean;
  blockReason: string | null;
  error: Error | null;
}

export interface OtaController extends OtaState {
  isBusy: boolean;
  check(): Promise<OtaCheckResult>;
  download(): Promise<OtaFetchResult>;
  postpone(): Promise<void>;
  reload(): Promise<void>;
  retry(): Promise<OtaCheckResult>;
  openStore(): Promise<void>;
}

export interface OtaUpdatesProps extends OtaOptions {
  renderBlocked?: (controller: OtaController) => ReactNode;
  renderAvailable?: (
    controller: OtaController,
    dismiss: () => void,
  ) => ReactNode;
}

/** Native manifests are data, not necessarily the full Expo manifest schema. */
export function manifestDetails(manifest: unknown): OtaManifest | null {
  return manifest && typeof manifest === "object"
    ? (manifest as OtaManifest)
    : null;
}

export function downloadsOnPostpone(
  policy: OtaPolicy | null | undefined,
): boolean {
  return (
    policy?.schemaVersion === 1 &&
    policy.delivery === "manual" &&
    !policy.guard &&
    policy.onPostpone === "download"
  );
}

/** A background force-OTA policy applies its downloaded manifest on the active app. */
export function requiresImmediateReload(
  policy: OtaPolicy | null | undefined,
): boolean {
  return (
    policy?.schemaVersion === 1 &&
    policy.delivery === "background" &&
    policy.guard?.action === "ota-force-update"
  );
}
