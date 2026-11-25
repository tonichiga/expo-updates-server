"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { ChevronDown, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Overview, useKindNames } from "@/src/client/devices/analytics";
import { Cohorts } from "@/src/client/devices/cohorts";
import { VersionAdoptionChart } from "@/src/client/devices/version-adoption-chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Registry, VersionTable } from "@/src/client/devices/registry";
import { useDevicesReport } from "@/src/client/devices/use-devices-report";
export default function DevicesPage() {
  const { t, formatLocale } = useI18n();
  const kindNames = useKindNames();
  const {
    filters,
    update,
    report,
    error,
    loading,
    reset,
    refresh,
    paginate,
  } = useDevicesReport();
  const activeFilters = Object.entries(filters).filter(
    ([key, value]) => key !== "days" && value.trim(),
  ).length;
  const options = report?.options;
  const period =
    filters.days === "1" ? t("24 часа") : t("{0} дней", [filters.days]);
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("Установки")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("Versions and activity reported by app installations.")}
          </p>
        </div>
        <Button
          size="sm"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw
            className={loading ? "animate-spin motion-reduce:animate-none" : ""}
          />
          {loading ? t("Обновление…") : t("Обновить")}
        </Button>
      </header>
      <Card className="gap-0 py-0 shadow-none">
        <CardContent className="px-4 sm:px-5">
          <Collapsible className="group/filters">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full flex-wrap justify-start gap-x-3 gap-y-2 py-3.5 whitespace-normal"
                aria-label={t("Фильтры")}
              >
                <SlidersHorizontal
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
                <span className="font-medium">{t("Фильтры")}</span>
                <span className="border-l pl-3 text-xs text-muted-foreground">
                  {period}
                </span>
                {activeFilters > 0 && (
                  <Badge variant="info">
                    {t("{0} filters applied", [activeFilters])}
                  </Badge>
                )}
                <ChevronDown
                  aria-hidden="true"
                  className="ml-auto size-4 text-muted-foreground group-data-[state=open]/filters:rotate-180"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div
                className="grid grid-cols-1 items-end gap-3 border-t py-4 min-[380px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
              >
                <Filter
                  label={t("Период активности")}
                  id="days"
                  value={filters.days}
                  onChange={(v) => update("days", v)}
                  items={[
                    ["1", t("24 часа")],
                    ["7", t("7 дней")],
                    ["30", t("30 дней")],
                  ]}
                />
                <Filter
                  label={t("Платформа")}
                  id="platform"
                  value={filters.platform}
                  onChange={(v) => update("platform", v)}
                  items={[
                    ["", t("Все платформы")],
                    ...["android", "ios"].map((v) => [
                      v,
                      v === "ios" ? "iOS" : "Android",
                    ]),
                  ]}
                />
                <Filter
                  label={t("Канал")}
                  id="channel"
                  value={filters.channel}
                  onChange={(v) => update("channel", v)}
                  items={[
                    ["", t("Все каналы")],
                    ...(options?.channels || []).map((v) => [v, v]),
                  ]}
                />
                <Filter
                  label={t("Runtime")}
                  id="runtime"
                  value={filters.runtime}
                  onChange={(v) => update("runtime", v)}
                  items={[
                    ["", t("Все runtime")],
                    ...(options?.runtimes || []).map((v) => [v, v]),
                  ]}
                />
                <Filter
                  label={t("Тип запуска")}
                  id="launchKind"
                  value={filters.launchKind}
                  onChange={(v) => update("launchKind", v)}
                  items={[["", t("Все типы")], ...Object.entries(kindNames)]}
                />
                <div className="grid gap-2">
                  <Label htmlFor="installation-search">
                    {t("Installation ID")}
                  </Label>
                  <Input
                    id="installation-search"
                    placeholder={t("ID или часть ID")}
                    value={filters.search}
                    maxLength={36}
                    pattern="[a-fA-F0-9\-]*"
                    title={t("Часть UUID: цифры, буквы a–f и дефисы")}
                    onChange={(e) => update("search", e.target.value)}
                    className="bg-background/40"
                  />
                </div>
                <div className="col-span-full flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={reset}
                  >
                    <X />
                    {t("Сбросить")}
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("Не удалось обновить данные")}</AlertTitle>
          <AlertDescription>
            {t(error)}
            {report && t(" Ниже показан предыдущий успешный результат.")}
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
            >
              {t("Повторить")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {loading && !report ? (
        <div
          role="status"
          aria-label={t("Загрузка статистики")}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : report ? (
        <Tabs
          defaultValue="overview"
          className="min-w-0 gap-4"
          aria-busy={loading}
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b pb-2">
            <TabsList
              aria-label={t("Аналитика приложения")}
              variant="line"
              className="grid h-auto w-full grid-cols-2 justify-start gap-0 sm:flex sm:w-fit"
            >
              {[
                ["overview", t("Overview")],
                ["versions", t("Versions")],
                ["cohorts", t("Cohorts")],
                ["registry", t("Registry")],
              ].map(([id, label]) => (
                <TabsTrigger
                  value={id}
                  key={id}
                  className="min-h-9 px-3 after:bottom-0! after:bg-primary"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <p className="text-xs text-muted-foreground">
              {t("Данные на {0}", [
                new Date(report.coverage.generatedAt).toLocaleTimeString(
                  formatLocale,
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  },
                ) + " UTC",
              ])}
            </p>
          </div>
          <TabsContent value="overview" className="min-w-0 space-y-4">
            <Overview report={report} />
          </TabsContent>
          <TabsContent value="versions" className="min-w-0 space-y-4">
            <VersionAdoptionChart report={report} />
            <VersionTable report={report} />
          </TabsContent>
          <TabsContent value="cohorts" className="min-w-0">
            <Cohorts report={report} />
          </TabsContent>
          <TabsContent value="registry" className="min-w-0">
            <Registry report={report} loading={loading} paginate={paginate} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
function Filter({
  label,
  id,
  value,
  onChange,
  items,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  items: string[][];
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={`filter-${id}`}>{label}</Label>
      <div className="[&>div]:w-full">
        <NativeSelect
          id={`filter-${id}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-background/40"
        >
          {!items.some(([v]) => v === value) && (
            <NativeSelectOption value={value}>{value}</NativeSelectOption>
          )}
          {items.map(([v, text]) => (
            <NativeSelectOption key={v} value={v}>
              {text}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
