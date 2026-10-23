import type { ReactNode } from 'react';
import type * as Updates from 'expo-updates';

export declare function start(): void;
export declare function getInstallationId(): Promise<string | null>;
export declare function getDeviceId(): Promise<string | null>;
/** Low-level compatibility API; new screens should use the shared lifecycle hook. */
export declare const checkForUpdateAsync: typeof Updates.checkForUpdateAsync;
export declare const fetchUpdateAsync: typeof Updates.fetchUpdateAsync;

export interface OtaPolicy {
  schemaVersion: number;
  delivery: 'manual' | 'background';
  guard?: { action: string; payload?: unknown };
}
export interface OtaOptions {
  /** Check at startup/foreground, at most once per minute. Default false. */
  autoCheck?: boolean;
  /** Download eligible manual releases automatically. Default false. */
  autoUpdate?: boolean;
  /** Reload downloaded non-background releases while active. Default false. */
  autoReload?: boolean;
  guardHandlers?: Record<string, (context: { action: string; payload: unknown; manifest: unknown }) =>
    'allow' | 'block' | Promise<'allow' | 'block'>>;
}
export interface OtaController {
  enabled: boolean;
  status: 'idle' | 'checking' | 'downloading' | 'reloading' | 'opening-store';
  installationId: string | null;
  deviceId: string | null;
  available: boolean;
  pending: boolean;
  candidate: { type: 'new' | 'rollback'; manifest: unknown } | null;
  policy: OtaPolicy | null;
  blocked: boolean;
  blockReason: string | null;
  error: Error | null;
  isBusy: boolean;
  check(): Promise<Updates.UpdateCheckResult>;
  download(): Promise<Updates.UpdateFetchResult>;
  reload(): Promise<void>;
  retry(): Promise<Updates.UpdateCheckResult>;
  openStore(): Promise<void>;
}
export declare function useOtaUpdates(options?: OtaOptions): OtaController;
export declare function OtaUpdateGate(props: { controller: OtaController; children?: ReactNode;
  renderBlocked?: (controller: OtaController) => ReactNode }): ReactNode;
