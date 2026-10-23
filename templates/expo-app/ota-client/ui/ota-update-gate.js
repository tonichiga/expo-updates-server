import { createElement as h, Fragment } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

/** Replace this view using renderBlocked; keep the controller's guard decision intact. */
export function OtaUpdateGate({ controller, children, renderBlocked }) {
  // Keep navigation/providers/splash handling mounted while the modal blocks interaction.
  let overlay = null;
  if (controller.blocked) {
    let content = h(DefaultGate, { controller });
    if (renderBlocked) content = renderBlocked(controller);
    overlay = h(Modal, { visible: true, animationType: 'none',
      presentationStyle: 'fullScreen', onRequestClose: () => {} }, content);
  }
  return h(Fragment, null, children, overlay);
}

function DefaultGate({ controller }) {
  let title = 'Update required';
  let description = 'An application update is required to continue.';
  let label = 'Retry';
  let action = controller.retry;
  if (controller.blockReason === 'ota-force-store-update') {
    description = 'Install the latest version from the store to continue.';
    label = 'Open store';
    action = controller.openStore;
  } else if (controller.blockReason === 'ota-force-update') {
    if (controller.pending) {
      description = 'The update is ready. Restart the application to continue.';
      label = 'Restart';
      action = controller.reload;
    }
  } else {
    title = 'Update needs attention';
    description = 'This update requires an action before you can continue.';
  }
  const childrenList = [h(Text, { key: 'title', style: styles.title, accessibilityRole: 'header' }, title),
    h(Text, { key: 'description', style: styles.text }, description)];
  if (controller.error) childrenList.push(h(Text, { key: 'error', style: styles.error, accessibilityRole: 'alert' }, controller.error.message));
  if (controller.isBusy) childrenList.push(h(ActivityIndicator, { key: 'busy', color: '#93c5fd', accessibilityLabel: 'Updating application' }));
  childrenList.push(h(Pressable, { key: 'action', style: styles.button, accessibilityRole: 'button',
    accessibilityState: { disabled: controller.isBusy }, disabled: controller.isBusy,
    onPress: () => { void action().catch(() => undefined); } }, h(Text, { style: styles.buttonText }, label)));
  if (controller.blockReason === 'ota-force-store-update') childrenList.push(h(Pressable, {
    key: 'retry', style: styles.button, accessibilityRole: 'button', disabled: controller.isBusy,
    onPress: () => { void controller.retry().catch(() => undefined); },
  }, h(Text, { style: styles.buttonText }, 'Check again')));
  return h(View, { style: styles.root }, ...childrenList);
}
const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 28, gap: 20, backgroundColor: '#0f172a' },
  title: { color: '#f8fafc', fontSize: 26, fontWeight: '700' },
  text: { color: '#cbd5e1', fontSize: 16, lineHeight: 24 },
  error: { color: '#fca5a5', fontSize: 14 },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2563eb', borderRadius: 12, padding: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
