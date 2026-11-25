"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Layers3,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  PlatformBadge,
  ChannelBadge,
  ReleaseStatusBadge,
  AudienceBadge,
  DeliveryBadge,
} from "@/components/admin/release-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import DistributionHistory from "@/src/client/distribution-history";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getUpdates } from "@/src/client/admin-api";
import type { ReleaseFilters } from "@/src/client/admin-types";
import { useFilteredResults } from "@/src/client/use-filtered-results";
import DistributionControl from "@/src/client/distribution-control";
import { useI18n } from "@/src/client/i18n/provider";
import { useFormatters } from "@/src/client/i18n/use-formatters";

const emptyFilters: ReleaseFilters = {
  q: "",
  platform: "",
  channel: "",
  runtime: "",
  status: "",
  audience: "",
};
const sorts = [
  ["createdAt", "По дате"],
  ["runtimeVersion", "По runtime"],
  ["platform", "По платформе"],
  ["channel", "По каналу"],
  ["status", "По статусу"],
  ["updateId", "По ID"],
];

const initialQuery = {
  ...emptyFilters,
  page: 1,
  sortBy: "createdAt",
  order: "desc" as "asc" | "desc",
};

function loadReleases(query: typeof initialQuery, signal: AbortSignal) {
  return getUpdates({ ...query, q: query.q.trim(), pageSize: 20 }, signal);
}

function hasFilters(query: ReleaseFilters) {
  return Boolean(
    query.q.trim() ||
      query.platform ||
      query.channel ||
      query.runtime ||
      query.status ||
      query.audience,
  );
}

export default function UpdatesPage() {
  const { t } = useI18n();
  const { number, fullDate } = useFormatters();
  const [historyRevision, setHistoryRevision] = useState(0);
  const [distributionBlocked, setDistributionBlocked] = useState(true);
  const {
    query,
    success,
    loading,
    error,
    request: requestPage,
  } = useFilteredResults(initialQuery, loadReleases);
  const result = success?.data;
  const resultsFiltered = success && hasFilters(success.query);

  function refreshReleases() {
    requestPage({ ...query });
    setHistoryRevision((value) => value + 1);
  }

  function reset() {
    requestPage({ ...query, ...emptyFilters, page: 1 });
  }
  function filter(
    key: keyof ReleaseFilters,
    label: string,
    options: [string, string][],
  ) {
    return (
      <Select
        value={"option:" + query[key]}
        onValueChange={(value) =>
          requestPage({ ...query, [key]: value.slice(7), page: 1 })
        }
      >
        <SelectTrigger aria-label={label} className="max-w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option:">{label}</SelectItem>
          {options.map(([value, title]) => (
            <SelectItem key={value} value={"option:" + value}>
              {title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  const locked =
    result?.rollbackLockByScope.filter((scope) => scope.rollbackActive) ?? [];
  const page = result?.page ?? 1;
  const pages = result?.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("Публикации")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("Manage release audiences, delivery policies and rollbacks.")}
          </p>
        </div>
        <Button
          size="sm"
          disabled={loading}
          onClick={refreshReleases}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          {t("Обновить")}
        </Button>
      </header>

      <DistributionControl onAvailabilityChange={setDistributionBlocked} />

      {locked.length > 0 && (
        <Alert role="status" variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>{t("Rollback активен")}</AlertTitle>
          <AlertDescription className="break-words">
            {t("Автодоставка новых обновлений временно отключена.")}{" "}
            {locked
              .map((s) => [s.runtimeVersion, s.platform, s.channel].join(" / "))
              .join(" · ")}
          </AlertDescription>
        </Alert>
      )}

      <Card className="min-w-0 gap-0 overflow-hidden py-0 shadow-none">
        <div className="space-y-4 border-b p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{t("Release history")}</h2>
              {result && (
                <Badge variant="info" className="tabular-nums">
                  {number(result.total)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <NativeSelect
                size="sm"
                aria-label={t("Сортировка списка апдейтов")}
                value={query.sortBy}
                onChange={(e) =>
                  requestPage({ ...query, sortBy: e.target.value, page: 1 })
                }
              >
                {sorts.map(([key, label]) => (
                  <option key={key} value={key}>
                    {t(label)}
                  </option>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                aria-label={
                  query.order === "desc"
                    ? t("Сортировать по возрастанию")
                    : t("Сортировать по убыванию")
                }
                onClick={() =>
                  requestPage({
                    ...query,
                    order: query.order === "desc" ? "asc" : "desc",
                    page: 1,
                  })
                }
              >
                <ArrowDownUp />
                {query.order === "desc" ? t("Descending") : t("Ascending")}
              </Button>
            </div>
          </div>
          <div role="search" className="space-y-3">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label={t("Search releases")}
                placeholder={t(
                  "Search by comment, update ID, version or channel",
                )}
                value={query.q}
                onChange={(event) => {
                  const q = event.target.value;
                  requestPage({ ...query, q, page: 1 }, Boolean(q.trim()));
                }}
              />
            </InputGroup>
            <div className="flex flex-wrap items-center gap-2">
              {filter("platform", t("Все платформы"), [
                ["ios", "iOS"],
                ["android", "Android"],
              ])}
              {filter(
                "channel",
                t("Все каналы"),
                (result?.filters?.channels ?? []).map((v) => [v, v]),
              )}
              {filter(
                "runtime",
                t("All runtimes"),
                (result?.filters?.runtimes ?? []).map((v) => [v, v]),
              )}
              {filter("status", t("All statuses"), [
                ["active", t("active")],
                ["draft", t("draft")],
                ["disabled", t("disabled")],
                ["rollback", t("Rollback")],
              ])}
              {filter("audience", t("All audiences"), [
                ["all", t("Все совместимые устройства")],
                ["devices", t("Выбранные устройства")],
              ])}
              {(hasFilters(query) || resultsFiltered) && (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  {t("Сбросить")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="border-b bg-destructive/5 p-4 text-sm text-destructive"
          >
            {t(error)} {result && t("Showing the previous results.")}{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestPage({ ...query })}
            >
              {t("Retry")}
            </Button>
          </div>
        )}
        <Table aria-busy={loading}>
          <TableHeader>
            <TableRow className="bg-muted/35">
              <TableHead className="pl-4 sm:pl-5">{t("Release")}</TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("Compatibility")}
              </TableHead>
              <TableHead>{t("Состояние")}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t("Audience")}
              </TableHead>
              <TableHead className="hidden xl:table-cell">
                {t("Доставка")}
              </TableHead>
              <TableHead className="hidden pr-5 text-right md:table-cell">
                {t("Создано")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!result && loading && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-36 text-center text-muted-foreground"
                >
                  {t("Загрузка обновлений…")}
                </TableCell>
              </TableRow>
            )}
            {result?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center">
                  <Layers3 className="mx-auto mb-3 size-6 text-muted-foreground" />
                  <p className="font-medium">
                    {resultsFiltered
                      ? t("No matching releases")
                      : t("Обновлений пока нет")}
                  </p>
                  {resultsFiltered ? (
                    <Button variant="link" size="sm" onClick={reset}>
                      {t("Сбросить")}
                    </Button>
                  ) : (
                    <p className="mt-1 whitespace-normal text-sm text-muted-foreground">
                      {t(
                        "Опубликуйте OTA, чтобы управлять его доставкой здесь.",
                      )}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            )}
            {result?.items.map((item) => (
              <TableRow key={item.key}>
                <TableCell className="max-w-44 whitespace-normal py-4 pl-4 sm:max-w-80 sm:pl-5">
                  <Link
                    href={`/updates/${item.encodedKey}`}
                    className="group inline-flex max-w-full items-start gap-1.5 rounded-sm font-semibold hover:text-primary"
                  >
                    <span className="line-clamp-2 break-words">
                      {item.comment ||
                        (item.appVersion
                          ? t("Version {0}", [item.appVersion])
                          : t("Release {0}", [item.updateId.slice(0, 8)]))}
                    </span>
                    <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </Link>
                  <div
                    className="mt-1 font-mono text-xs text-muted-foreground"
                    title={item.updateId}
                  >
                    {item.updateId.slice(0, 8)}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground lg:hidden">
                    <PlatformBadge platform={item.platform} />
                    <ChannelBadge channel={item.channel} />
                    <span className="break-all">{item.runtimeVersion}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-60 whitespace-normal lg:table-cell">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <PlatformBadge platform={item.platform} />
                    <ChannelBadge channel={item.channel} />
                  </div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {t("Runtime {0}", [item.runtimeVersion])}
                    {item.appVersion ? ` · ${t("App")} ${item.appVersion}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1.5">
                    <ReleaseStatusBadge release={item} />
                    {item.isLatest && (
                      <span className="text-xs text-muted-foreground">
                        {t("Latest")}
                      </span>
                    )}
                    {(item.isRollbackActive || item.isIgnoredByRollback) && (
                      <Badge
                        variant={
                          item.isRollbackActive ? "destructive" : "warning"
                        }
                        className="max-w-36 whitespace-normal text-left"
                      >
                        {item.isRollbackActive
                          ? t("Rollback")
                          : t("Ignored by rollback")}
                      </Badge>
                    )}
                    <div className="max-w-32 sm:hidden">
                      <AudienceBadge mode={item.audienceMode} compact />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <AudienceBadge mode={item.audienceMode} compact />
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <DeliveryBadge mode={item.deliveryMode} />
                  {item.hasGuard && (
                    <Badge className="ml-1.5" variant="warning">
                      {t("Guard")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden pr-5 text-right text-xs text-muted-foreground md:table-cell">
                  {fullDate(item.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {loading
              ? t("Загрузка...")
              : t("Page {0} of {1}", [number(page), number(pages)])}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page <= 1}
              onClick={() => requestPage({ ...query, page: page - 1 })}
            >
              <ChevronLeft />
              {t("Назад")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page >= pages}
              onClick={() => requestPage({ ...query, page: page + 1 })}
            >
              {t("Вперёд")}
              <ChevronRight />
            </Button>
          </div>
        </footer>
      </Card>

      <DistributionHistory
        revision={historyRevision}
        blocked={distributionBlocked}
        onRestored={refreshReleases}
      />
    </div>
  );
}
