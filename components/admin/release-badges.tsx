"use client";

import { Check, CircleOff, GitBranch, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/src/client/i18n/provider";
import type { UpdateItem } from "@/src/client/admin-types";
import type { DeviceLaunchKind } from "@/src/server/devices/report-types";

export function ReleaseVersionBadges({
  runtimeVersion,
  appVersion,
}: Pick<UpdateItem, "runtimeVersion" | "appVersion">) {
  const { t } = useI18n();
  const versions = [
    [t("Runtime"), runtimeVersion, "neutral"],
    [t("App"), appVersion, "outline"],
  ] as const;
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-1.5">
      {versions.map(([label, value, variant]) =>
        value ? (
          <Badge
            key={label}
            variant={variant}
            className="max-w-full items-baseline rounded-md px-1.5 whitespace-normal"
          >
            <span>{label}</span>{" "}
            <span className="min-w-0 font-mono font-semibold [overflow-wrap:anywhere]">
              {value}
            </span>
          </Badge>
        ) : null,
      )}
    </div>
  );
}

export function LatestReleaseBadge() {
  const { t } = useI18n();
  const description = t("Channel’s latest release for this runtime and platform, regardless of activation");
  return (
    <Badge variant="info" title={description}>
      {t("Latest")}
      <span className="sr-only"> · {description}</span>
    </Badge>
  );
}

export function PlatformBadge({ platform }: { platform: string }) {
  if (platform === "ios") return <Badge variant="info">iOS</Badge>;
  if (platform === "android") return <Badge variant="positive">Android</Badge>;
  return <Badge variant="neutral">{platform}</Badge>;
}

const channelTones = new Map<string, "violet" | "warning" | "teal">([
  ["production", "violet"],
  ["prod", "violet"],
  ["preview", "warning"],
  ["staging", "warning"],
  ["beta", "warning"],
  ["development", "teal"],
  ["dev", "teal"],
]);

export function ChannelBadge({ channel }: { channel: string }) {
  const variant = channelTones.get(channel) ?? "neutral";
  return (
    <Badge
      variant={variant}
      title={channel}
      className="max-w-full min-w-0 shrink"
    >
      <GitBranch aria-hidden="true" className="shrink-0" />
      <span className="truncate">{channel}</span>
    </Badge>
  );
}

export function ReleaseStatusBadge({
  release,
}: {
  release: Pick<UpdateItem, "status" | "policyEditable">;
}) {
  const { t } = useI18n();
  const state = release.policyEditable ? "draft" : release.status;
  const Icon =
    state === "draft" ? Pencil : state === "active" ? Check : CircleOff;
  return (
    <Badge
      variant={
        state === "draft"
          ? "warning"
          : state === "active"
            ? "positive"
            : "neutral"
      }
    >
      <Icon aria-hidden="true" />
      {t(state)}
    </Badge>
  );
}

export function AudienceBadge({
  mode,
  compact = false,
}: {
  mode: UpdateItem["audienceMode"];
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Badge
      variant={mode === "devices" ? "violet" : "teal"}
      className="max-w-full whitespace-normal text-left"
    >
      {mode === "devices"
        ? t("Выбранные устройства")
        : compact
          ? t("All devices")
          : t("Все совместимые устройства")}
    </Badge>
  );
}

export function deliveryLabel(mode: UpdateItem["deliveryMode"]) {
  if (mode === "manual-postpone") return "Download on postpone";
  return mode === "background" ? "Background" : "Manual";
}

export function DeliveryBadge({ mode }: { mode: UpdateItem["deliveryMode"] }) {
  const { t } = useI18n();
  return (
    <Badge
      variant={
        mode === "manual-postpone"
          ? "teal"
          : mode === "background" ? "info" : "neutral"
      }
    >
      {t(deliveryLabel(mode))}
    </Badge>
  );
}

export const launchKindTone = {
  ota: "info",
  embedded: "teal",
  unknown: "warning",
} as const satisfies Record<DeviceLaunchKind, string>;
