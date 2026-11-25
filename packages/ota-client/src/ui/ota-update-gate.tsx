import type { ReactNode } from "react";
import type { OtaController, OtaUpdatesProps } from "../types";
import { OtaUpdateOverlay } from "./ota-updates";

/** Compatibility for existing layouts; new integrations render OtaUpdates beside navigation. */
export function OtaUpdateGate({
  controller,
  children,
  renderBlocked,
}: {
  controller: OtaController;
  children?: ReactNode;
  renderBlocked?: OtaUpdatesProps["renderBlocked"];
}) {
  return (
    <>
      {children}
      <OtaUpdateOverlay
        controller={controller}
        renderBlocked={renderBlocked}
        showAvailable={false}
      />
    </>
  );
}
