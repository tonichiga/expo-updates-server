import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { initializeOtaClient as initialize } from "./runtime-core";
import type { OtaClientAdapter, OtaClientConfig } from "./types";

export { enabled, start, getInstallationId, getDeviceId, checkForUpdateAsync, fetchUpdateAsync } from "./runtime-core";

const adapter: OtaClientAdapter = {
  storage: {
    getItem: key => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: key => AsyncStorage.removeItem(key),
  },
  randomUUID: () => Crypto.randomUUID(),
  sha256: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
};

export function initializeOtaClient(config: OtaClientConfig) {
  initialize({ ...config, adapter });
}
