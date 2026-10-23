import type { ReactNode } from "react";

export interface OtaPolicy {
  schemaVersion: number;
  delivery: "manual" | "background";
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
  /** Reload non-background updates while the application is active. */
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
