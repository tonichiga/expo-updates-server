"use client";
import { useFormatters } from "@/src/client/i18n/use-formatters";
import { useI18n } from "@/src/client/i18n/provider";

import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useState } from "react";
import { ChevronDown, ChevronUp, BarChart3, Layers } from "lucide-react";
import {
  PlatformBadge,
  ChannelBadge,
  launchKindTone,
} from "@/components/admin/release-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DevicesReport } from "@/src/server/devices/report-types";
import { groupVersions, type VersionScope } from "./version-groups";
function useKindLabels() {
  const { t } = useI18n();
  return {
    ota: "OTA",
    embedded: t("Embedded"),
    unknown: t("Не определён"),
  };
}
const kindColors = {
  ota: "var(--chart-1)",
  embedded: "var(--chart-2)",
  unknown: "var(--chart-3)",
};
const PREVIEW_ROWS = 6;
function ScopeChart({ scope }: { scope: VersionScope }) {
  const { number, share } = useFormatters();
  const { t } = useI18n();
  const kindLabels = useKindLabels();

  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? scope.versions
    : scope.versions.slice(0, PREVIEW_ROWS);
  return (
    <section
      className="@container min-w-0 rounded-lg border bg-background/35 p-3 sm:p-4"
      aria-label={t("Канал {0}, {1}", [scope.channel, scope.platform])}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 max-w-full">
            <ChannelBadge channel={scope.channel} />
          </h4>
          <PlatformBadge platform={scope.platform} />
        </div>
        <span className="text-xs text-muted-foreground">
          {t("Активных установок:")}{" "}
          <strong className="font-medium text-foreground">
            {number(scope.total)}
          </strong>
        </span>
      </header>
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(4rem,1.4fr)_6.5rem] gap-5 border-b pb-3 text-xs text-muted-foreground @min-[32rem]:grid">
        <span>{t("Версия приложения / OTA")}</span>
        <div className="flex justify-between">
          <span>0%</span>
          <span>100%</span>
        </div>
        <span className="text-right">{t("Количество · доля")}</span>
      </div>
      <ol
        className={expanded ? "max-h-[560px] overflow-y-auto pr-2" : ""}
        aria-label={t("Версии в {0}, {1}", [scope.channel, scope.platform])}
      >
        {visible.map((version) => (
          <li
            key={version.key}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 border-b py-3 last:border-b-0 @min-[32rem]:grid-cols-[minmax(0,1fr)_minmax(4rem,1.4fr)_6.5rem] @min-[32rem]:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-all text-base font-semibold">
                  {version.appVersion || t("Версия не указана")}
                </p>
                <Badge
                  variant={launchKindTone[version.kind]}
                  className="font-mono text-[11px]"
                  title={version.updateId || undefined}
                >
                  {kindLabels[version.kind]}
                  {version.updateId ? ` ${version.updateId.slice(0, 8)}` : ""}
                </Badge>
              </div>
              <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                {t("Native:")} {version.nativeBuilds.join(", ")}
              </p>
              {version.updateId && (
                <Collapsible className="group/id mt-1 text-xs text-muted-foreground">
                  <CollapsibleTrigger asChild>
                    <Button size="xs" variant="ghost" className="-ml-1 px-1">
                      <ChevronDown
                        className="size-3 group-data-[state=open]/id:rotate-180"
                        aria-hidden="true"
                      />
                      {t("Полный ID")}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <code className="mt-1 block break-all select-all">
                      {version.updateId}
                    </code>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
            <div
              className="col-span-2 row-start-2 flex h-3 items-center @min-[32rem]:col-span-1 @min-[32rem]:col-start-2 @min-[32rem]:row-start-1 overflow-hidden rounded-sm bg-muted"
              role="img"
              aria-label={t(
                "{0}, {1} {2}: {3} установок, {4} внутри канала {5}, {6}",
                [
                  version.appVersion || t("Версия не указана"),
                  kindLabels[version.kind],
                  version.updateId || "",
                  number(version.installations),
                  share(version.installations, scope.total),
                  scope.channel,
                  scope.platform,
                ],
              )}
            >
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${scope.total ? (version.installations / scope.total) * 100 : 0}%`,
                  minWidth: version.installations ? 2 : 0,
                  background: kindColors[version.kind],
                }}
              />
            </div>
            <div className="col-start-2 row-start-1 flex flex-wrap items-baseline justify-end gap-x-2 tabular-nums @min-[32rem]:col-start-3">
              <strong className="text-base font-semibold">
                {number(version.installations)}
              </strong>
              <span className="text-sm text-muted-foreground">
                {share(version.installations, scope.total)}
              </span>
            </div>
          </li>
        ))}
      </ol>
      {scope.versions.length > PREVIEW_ROWS && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {t("Показано ")}
            {visible.length} {t(" из ")}
            {scope.versions.length} {t(" версий. Доли учитывают весь блок.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp /> : <ChevronDown />}
            {expanded
              ? t("Свернуть")
              : t("Показать все ({0})", [scope.versions.length])}
          </Button>
        </div>
      )}
    </section>
  );
}
export function VersionAdoptionChart({ report }: { report: DevicesReport }) {
  const kindLabels = useKindLabels();
  const { number } = useFormatters();
  const { t } = useI18n();
  const runtimes = groupVersions(report.versions);
  const period =
    report.filters.days === 1
      ? t("24 часа")
      : t("{0} дней", [report.filters.days]);
  return (
    <Card
      className="min-w-0 shadow-none"
      aria-labelledby="version-adoption-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle id="version-adoption-title">
            <h2>{t("Активные установки по версиям")}</h2>
          </CardTitle>
          <Badge variant="info">
            {t("Всего: ")}
            {number(report.total)}
          </Badge>
        </div>
        <CardDescription>
          {t("Активность за последние ")}
          {period}
          {t(
            ". Runtime → канал → платформа → версия. Доля считается внутри каждого блока канала и платформы.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-4 sm:px-6">
        {runtimes.length ? (
          <>
            <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {Object.entries(kindLabels).map(([kind, label]) => (
                <span key={kind} className="inline-flex items-center gap-2">
                  <i
                    className="size-2 rounded-full"
                    style={{
                      background: kindColors[kind as keyof typeof kindColors],
                    }}
                  />
                  {label}
                </span>
              ))}
            </div>
            <div className="space-y-6">
              {runtimes.map((runtime) => (
                <section
                  key={runtime.runtime}
                  aria-label={t("Runtime {0}", [runtime.runtime])}
                >
                  <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="flex min-w-0 items-center gap-2 text-sm">
                      <Layers className="size-4 shrink-0 text-muted-foreground" />
                      <span className="shrink-0 text-muted-foreground">
                        {t("Runtime")}
                      </span>
                      <span className="break-all font-semibold">
                        {runtime.runtime}
                      </span>
                    </h3>
                    <Badge variant="info">
                      {t("Установок: ")}
                      {number(runtime.total)}
                    </Badge>
                  </header>
                  <div className="space-y-3">
                    {runtime.scopes.map((scope) => (
                      <ScopeChart key={scope.key} scope={scope} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              {t(
                "Версия берётся из опубликованной сборки. ID различает OTA с одинаковой версией; одна OTA на разных native-сборках объединяется в одну полосу. Учитываются установки приложения за период.",
              )}
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <BarChart3 className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              {t("Нет активных установок в этой выборке")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("Измените фильтры или дождитесь heartbeat от приложения.")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
