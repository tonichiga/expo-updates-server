"use client";

import { Check, CircleOff, GitBranch, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/src/client/i18n/provider";
import type { UpdateItem } from "@/src/client/admin-types";
import type { DeviceLaunchKind } from "@/src/server/devices/report-types";

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

export function DeliveryBadge({ mode }: { mode: UpdateItem["deliveryMode"] }) {
  const { t } = useI18n();
  return (
    <Badge variant={mode === "background" ? "info" : "neutral"}>
      {mode === "background" ? t("Background") : t("Manual")}
    </Badge>
  );
}

export const launchKindTone = {
  ota: "info",
  embedded: "teal",
  unknown: "warning",
} as const satisfies Record<DeviceLaunchKind, string>;
