import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { OtaController, OtaUpdatesProps } from "../types";
import { manifestDetails } from "../types";
import { useOtaUpdates } from "../model/hooks/useOtaUpdates";

/** Mount once beside navigation. No context or application wrapper is required. */
export function OtaUpdates({
  autoCheck = true,
  autoUpdate = false,
  autoReload = false,
  guardHandlers,
  renderBlocked,
  renderAvailable,
}: OtaUpdatesProps) {
  const controller = useOtaUpdates({
    autoCheck,
    autoUpdate,
    autoReload,
    guardHandlers,
  });
  return (
    <OtaUpdateOverlay
      controller={controller}
      renderBlocked={renderBlocked}
      renderAvailable={renderAvailable}
    />
  );
}

interface OverlayProps
  extends Pick<OtaUpdatesProps, "renderBlocked" | "renderAvailable"> {
  controller: OtaController;
  showAvailable?: boolean;
}

export function OtaUpdateOverlay({
  controller,
  renderBlocked,
  renderAvailable,
  showAvailable = true,
}: OverlayProps) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const candidateId =
    manifestDetails(controller.candidate?.manifest)?.id ??
    controller.candidate?.type ??
    "update";
  const noticeId = `${candidateId}:${controller.pending}`;
  const dismiss = () => {
    if (!controller.blocked) setDismissed(noticeId);
  };
  const optional =
    showAvailable &&
    controller.available &&
    controller.policy?.delivery !== "background" &&
    dismissed !== noticeId;
  if (!controller.blocked && !optional) return null;

  let content = <UpdateNotice controller={controller} dismiss={dismiss} />;
  if (controller.blocked && renderBlocked)
    content = <>{renderBlocked(controller)}</>;
  if (!controller.blocked && renderAvailable)
    content = <>{renderAvailable(controller, dismiss)}</>;

  return (
    <Modal
      visible
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={dismiss}
    >
      {content}
    </Modal>
  );
}

function UpdateNotice({
  controller,
  dismiss,
}: {
  controller: OtaController;
  dismiss: () => void;
}) {
  let title = "Update available";
  let description =
    "A new version is available. Download it now or continue using the application.";
  let label = "Download";
  let action: () => Promise<unknown> = controller.download;
  if (controller.pending) {
    description = "The update is ready. Restart the application to apply it.";
    label = "Restart";
    action = controller.reload;
  }
  if (controller.blocked) {
    title = "Update required";
    description = "An application update is required to continue.";
    label = "Retry";
    action = controller.retry;
    if (controller.blockReason === "ota-force-store-update") {
      description = "Install the latest version from the store to continue.";
      label = "Open store";
      action = controller.openStore;
    } else if (controller.blockReason === "ota-force-update") {
      if (controller.pending) {
        description =
          "The update is ready. Restart the application to continue.";
        label = "Restart";
        action = controller.reload;
      }
    } else {
      title = "Update needs attention";
      description = "This update requires an action before you can continue.";
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.text}>{description}</Text>
      {controller.error && (
        <Text style={styles.error} accessibilityRole="alert">
          {controller.error.message}
        </Text>
      )}
      {controller.isBusy && (
        <ActivityIndicator
          color="#93c5fd"
          accessibilityLabel="Updating application"
        />
      )}
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityState={{ disabled: controller.isBusy }}
        disabled={controller.isBusy}
        onPress={() => {
          void action().catch(() => undefined);
        }}
      >
        <Text style={styles.buttonText}>{label}</Text>
      </Pressable>
      {controller.blockReason === "ota-force-store-update" && (
        <Pressable
          style={styles.button}
          accessibilityRole="button"
          disabled={controller.isBusy}
          onPress={() => {
            void controller.retry().catch(() => undefined);
          }}
        >
          <Text style={styles.buttonText}>Check again</Text>
        </Pressable>
      )}
      {!controller.blocked && (
        <Pressable
          style={styles.button}
          accessibilityRole="button"
          onPress={dismiss}
        >
          <Text style={styles.buttonText}>Later</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 20,
    backgroundColor: "#0f172a",
  },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "700" },
  text: { color: "#cbd5e1", fontSize: 16, lineHeight: 24 },
  error: { color: "#fca5a5", fontSize: 14 },
  button: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    padding: 12,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
