export {
  initializeOtaClient,
  start,
  getInstallationId,
  getDeviceId,
  checkForUpdateAsync,
  fetchUpdateAsync,
} from "./runtime-core";
export { useOtaUpdates } from "./model/hooks/useOtaUpdates";
export { OtaUpdateGate } from "./ui/ota-update-gate";
export { OtaUpdates } from "./ui/ota-updates";
export type {
  OtaClientConfig,
  OtaClientAdapter,
  OtaOptions,
  OtaController,
  OtaUpdatesProps,
  OtaPolicy,
} from "./types";
export { migrateOtaStorage } from "./migrate-storage";
