"use client";
import { useFormatters } from "@/src/client/i18n/use-formatters";
import { useI18n } from "@/src/client/i18n/provider";

import { DeviceName } from "./device-name";
import { AdminRoleContext } from "@/components/admin/admin-role";
import { BookmarkTarget, useFavoriteTargets } from "./favorite-targets";
import { useContext, useRef, useState } from "react";
import { Copy, Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PlatformBadge,
  ChannelBadge,
  launchKindTone,
} from "@/components/admin/release-badges";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type {
  DeviceInstallation,
  DevicesReport,
} from "@/src/server/devices/report-types";
import { useKindNames } from "./analytics";
function CopyValue({ value }: { value: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all text-xs leading-6">
        {value}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={t("Скопировать {0}", [value])}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        {state === "copied" ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
      <span className="sr-only" role="status">
        {state === "copied"
          ? t("Скопировано")
          : state === "failed"
            ? t("Не удалось скопировать. Выделите текст вручную.")
            : ""}
      </span>
    </div>
  );
}
export function Registry({
  report,
  loading,
  paginate,
}: {
  report: DevicesReport;
  loading: boolean;
  paginate: (offset: number) => void;
}) {
  const { t } = useI18n();
  const opener = useRef<HTMLButtonElement | null>(null);
  const kindNames = useKindNames();
  const { number, fullDate, calendarDate } = useFormatters();
  const [selected, setSelected] = useState<DeviceInstallation | null>(null);
  const role = useContext(AdminRoleContext);
  const canBookmark = role === "admin" || role === "operator";
  const personal = useFavoriteTargets(
    selected?.platform ?? "",
    !!selected && canBookmark,
    0,
  );
  return (
    <>
      <Card className="min-w-0 shadow-none">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>
              <h2>{t("Реестр установок")}</h2>
            </CardTitle>
            <Badge variant="info">{number(report.total)}</Badge>
          </div>
          <CardDescription>
            {t(
              "Последнее известное состояние. Нажмите на ID, чтобы посмотреть детали.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 px-4 sm:px-6">
          <Table aria-label={t("Реестр установок")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Установка")}</TableHead>
                <TableHead>{t("Платформа / канал")}</TableHead>
                <TableHead>{t("Версия")}</TableHead>
                <TableHead>{t("Запуск")}</TableHead>
                <TableHead>{t("Последняя связь · UTC")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.devices.map((d) => (
                <TableRow key={`${d.platform}:${d.installation_id}`}>
                  <TableCell>
                    <Button
                      variant="link"
                      className="h-auto p-0 font-mono text-xs"
                      title={d.installation_id}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setSelected(d);
                      }}
                      aria-label={t("Детали установки {0}", [
                        d.installation_id,
                      ])}
                    >
                      {d.installation_id.slice(0, 8)}…
                      {d.installation_id.slice(-4)}
                    </Button>
                    {d.device_id && (
                      <p className="font-mono text-xs text-muted-foreground">
                        {t("Device ID")} · {d.device_id.slice(0, 12)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("С ")}
                      {calendarDate(d.first_seen_at)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-52 flex-wrap items-center gap-1">
                      <PlatformBadge platform={d.platform} />
                      <ChannelBadge channel={d.channel} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <p
                      className="max-w-56 truncate text-sm"
                      title={
                        d.update_label ||
                        d.resolved_update_id ||
                        kindNames[d.launch_kind]
                      }
                    >
                      {d.update_label ||
                        d.resolved_update_id?.slice(0, 8) ||
                        kindNames[d.launch_kind]}
                    </p>
                    <p
                      className="mt-1 text-xs text-muted-foreground"
                      title={d.runtime_version}
                    >
                      {d.runtime_version}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("Native")} {d.native_version || "—"} (
                      {d.native_build || "—"})
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={launchKindTone[d.launch_kind]}>
                      {kindNames[d.launch_kind]}
                    </Badge>
                    {d.emergency_launch && (
                      <Badge variant="destructive" className="mt-1 block w-fit">
                        {t("Emergency")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {fullDate(d.last_seen_at).replace(" UTC", "")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!report.devices.length && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Search className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">{t("Установки не найдены")}</p>
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                {t(
                  "Измените фильтры или дождитесь heartbeat от приложения с подключённой телеметрией.",
                )}
              </p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {report.total
                ? t("{0}–{1} из {2}", [
                    number(report.offset + 1),
                    number(
                      Math.min(report.offset + report.pageSize, report.total),
                    ),
                    number(report.total),
                  ])
                : t("0 установок")}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={loading || report.offset === 0}
                onClick={() =>
                  paginate(Math.max(0, report.offset - report.pageSize))
                }
              >
                <ChevronLeft />
                {t("Назад")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  loading || report.offset + report.pageSize >= report.total
                }
                onClick={() => paginate(report.offset + report.pageSize)}
              >
                {t("Далее")}
                <ChevronRight />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>{t("Детали установки")}</SheetTitle>
            <SheetDescription>
              {t(
                "Идентификатор установки приложения и последнее зарегистрированное состояние.",
              )}
            </SheetDescription>
          </SheetHeader>
          {selected && canBookmark && (
            <div className="mx-4 space-y-2 sm:mx-6">
              {personal.error && (
                <p role="alert" className="text-sm text-destructive">
                  {t(personal.error)}
                </p>
              )}
              <BookmarkTarget
                platform={selected.platform}
                deviceId={selected.device_id ?? null}
                installationId={selected.installation_id}
                displayName={null}
                showLabel
                favorites={personal.favorites ?? []}
                onChanged={personal.refresh}
              />
            </div>
          )}
          {selected?.device_id && (
            <DeviceName
              key={selected.device_id}
              deviceId={selected.device_id}
              platform={selected.platform}
            />
          )}
          {selected && (
            <dl className="divide-y px-4 pb-6 sm:px-6">
              {[
                [t("Installation ID"), selected.installation_id],
                [t("Device ID"), selected.device_id || "—"],
                [t("Платформа"), selected.platform],
                [t("Канал"), selected.channel],
                [t("Runtime"), selected.runtime_version],
                [
                  t("Native version / build"),
                  `${selected.native_version || "—"} (${selected.native_build || "—"})`,
                ],
                [t("Тип запуска"), kindNames[selected.launch_kind]],
                [t("Название обновления"), selected.update_label || "—"],
                [t("OTA artifact ID"), selected.resolved_update_id || "—"],
                [t("Launch update ID"), selected.reported_update_id || "—"],
                [
                  t("Emergency launch"),
                  selected.emergency_launch ? t("Да") : t("Нет"),
                ],
                [t("Первый heartbeat"), fullDate(selected.first_seen_at)],
                [t("Последний heartbeat"), fullDate(selected.last_seen_at)],
                [
                  t("Время события на устройстве"),
                  fullDate(selected.observed_at),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid items-start gap-1.5 py-3 sm:grid-cols-[9rem_1fr]"
                >
                  <dt className="mb-1 text-xs font-medium text-muted-foreground">
                    {label}
                  </dt>
                  <dd>
                    {label.includes("ID") && value !== "—" ? (
                      <CopyValue value={value} />
                    ) : (
                      <p className="break-words text-sm">{value}</p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function VersionTable({ report }: { report: DevicesReport }) {
  const { t } = useI18n();
  const kindNames = useKindNames();
  const { number, share } = useFormatters();
  return (
    <Card className="min-w-0 gap-4 shadow-none">
      <CardHeader>
        <CardTitle>
          <h2>
            {t("Все версии · ")}
            {number(report.versions.length)}
          </h2>
        </CardTitle>
        <CardDescription>
          {t("Shares across all installations in the selected period.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-4 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Версия / ID")}</TableHead>
              <TableHead>{t("Платформа / канал")}</TableHead>
              <TableHead>{t("Runtime / native")}</TableHead>
              <TableHead>{t("Запуск")}</TableHead>
              <TableHead className="text-right">{t("Установки")}</TableHead>
              <TableHead className="text-right">{t("Доля")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.versions.map((v, i) => (
              <TableRow key={i}>
                <TableCell>
                  <p
                    className="max-w-56 truncate font-medium"
                    title={v.update_label || undefined}
                  >
                    {v.update_label || kindNames[v.launch_kind]}
                  </p>
                  {v.update_id && (
                    <code
                      className="mt-1 block text-xs text-muted-foreground"
                      title={v.update_id}
                    >
                      {v.update_id}
                    </code>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-52 flex-wrap items-center gap-1">
                    <PlatformBadge platform={v.platform} />
                    <ChannelBadge channel={v.channel} />
                  </div>
                </TableCell>
                <TableCell>
                  {v.runtime_version}
                  <p className="text-xs text-muted-foreground">
                    {v.native_version || "—"} ({v.native_build || "—"})
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant={launchKindTone[v.launch_kind]}>
                    {kindNames[v.launch_kind]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {number(v.installations)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {share(v.installations, report.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!report.versions.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("Нет версий в выбранной выборке.")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
