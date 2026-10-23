import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as Updates from 'expo-updates';
import { AppState, Linking, Platform } from 'react-native';
import { enabled, start, getInstallationId, getDeviceId, checkForUpdateAsync, fetchUpdateAsync } from '../../runtime';
import { createUpdateController } from '../update-controller';

const controller = createUpdateController({
  enabled, start,
  identity: async () => ({ installationId: await getInstallationId(), deviceId: await getDeviceId() }),
  check: checkForUpdateAsync,
  fetch: fetchUpdateAsync,
  runningCandidate: () => ({ type: 'new', manifest: Updates.manifest }),
  reload: () => Updates.reloadAsync(),
  isActive: () => AppState.currentState === 'active',
  openStore: async (payload) => {
    const url = payload?.[`${Platform.OS}Url`] || payload?.url;
    if (typeof url !== 'string' || !/^(https:\/\/|market:\/\/|itms-apps:\/\/)/i.test(url)) {
      throw new Error('The store update policy must provide a valid https/store URL');
    }
    await Linking.openURL(url);
  },
});
const emptyOptions = Object.freeze({});

/** Configure once in the root; additional consumers share identity, state and actions. */
export function useOtaUpdates(options = emptyOptions) {
  const owner = useRef(Symbol('ota-updates'));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const native = Updates.useUpdates();
  const { autoCheck = false, autoUpdate = false, autoReload = false, guardHandlers } = options;
  useEffect(() => {
    const token = owner.current;
    controller.configure(token, { autoCheck, autoUpdate, autoReload, guardHandlers });
    void controller.initialize().catch(() => undefined);
    controller.automaticCheck();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') controller.automaticCheck();
    });
    return () => { subscription.remove(); controller.removeOwner(token); };
  }, [autoCheck, autoUpdate, autoReload, guardHandlers]);
  const downloaded = native.downloadedUpdate;
  useEffect(() => {
    if (!enabled || !downloaded || !native.isUpdatePending) return;
    void controller.syncPending({ type: downloaded.type, manifest: downloaded.manifest }).catch(() => undefined);
  }, [downloaded, native.isUpdatePending]);
  return { ...state, isBusy: state.status !== 'idle', check: controller.check,
    download: controller.download, reload: controller.reload, retry: controller.retry, openStore: controller.openStore };
}
