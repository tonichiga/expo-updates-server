"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Analytics, useKindNames } from "@/src/client/devices/analytics";
import { Registry } from "@/src/client/devices/registry";
import {
  useDevicesReport,
  type Filters,
} from "@/src/client/devices/use-devices-report";
export default function DevicesPage() {
  const { t, formatLocale } = useI18n();
  const kindNames = useKindNames();
  const {
    filters,
    setFilters,
    applied,
    report,
    error,
    loading,
    apply,
    reset,
    refresh,
    paginate,
  } = useDevicesReport();
  const dirty = JSON.stringify(filters) !== JSON.stringify(applied);
  const activeFilters = Object.entries(applied).filter(
    ([key, value]) => key !== "days" && value,
  ).length;
  const update = (key: keyof Filters, value: string) =>
    setFilters((previous) => ({ ...previous, [key]: value }));
  const options = report?.options;
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[.16em] text-muted-foreground">
            {t("Аналитика приложения")}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">
            {t("Установки")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Версии, активность и переход на OTA в одном месте.")}
          </p>
        </div>
        <Button variant="outline" disabled={loading} onClick={refresh}>
          <RefreshCw
            className={loading ? "animate-spin motion-reduce:animate-none" : ""}
          />
          {loading ? t("Обновление…") : t("Обновить")}
        </Button>
      </header>
      <Card className="gap-0 py-5 shadow-none">
        <CardContent>
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            {t("Фильтры")}
            {activeFilters > 0 && (
              <Badge variant="secondary">{activeFilters}</Badge>
            )}
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {t("Вся выборка")}
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
            className="grid grid-cols-2 items-end gap-3 lg:grid-cols-3 2xl:grid-cols-6"
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
              label="Runtime"
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
              <Label htmlFor="installation-search">Installation ID</Label>
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
            <div className="flex flex-wrap items-center gap-2 col-span-2 lg:col-span-3 2xl:col-span-6">
              <Button type="submit" size="sm" disabled={loading}>
                {t("Применить")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={reset}
                disabled={loading}
              >
                <X />
                {t("Сбросить")}
              </Button>
              {dirty && (
                <span className="text-xs text-muted-foreground">
                  {t("Есть неприменённые изменения")}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {report && !loading
                  ? t("Данные на {0}", [
                      new Date(report.coverage.generatedAt).toLocaleTimeString(
                        formatLocale,
                        { hour: "2-digit", minute: "2-digit" },
                      ),
                    ])
                  : ""}
              </span>
            </div>
          </form>
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
        <div
          className={loading ? "space-y-6 opacity-60" : "space-y-6"}
          aria-busy={loading}
        >
          <Analytics report={report} />
          <Registry report={report} loading={loading} paginate={paginate} />
          <p className="text-xs leading-5 text-muted-foreground">
            {t(
              "Метрика считает установки приложения, а не уникальных людей. Сводка и реестр отражают последнее состояние; график — состояние на конец каждого дня. Переустановка может изменить Installation ID.",
            )}
          </p>
        </div>
      ) : null}
    </main>
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
