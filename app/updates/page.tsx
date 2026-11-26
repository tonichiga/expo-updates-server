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
  LatestReleaseBadge,
  ReleaseVersionBadges,
  deliveryLabel,
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

      <Card className="@container min-w-0 gap-0 overflow-hidden py-0 shadow-none">
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
        <Table aria-label={t("Release history")} aria-busy={loading} className="table-fixed">
          <TableHeader className="@max-3xl:sr-only">
            <TableRow className="bg-muted/35">
              <TableHead scope="col" className="w-[33%] pl-5">{t("Release")}</TableHead>
              <TableHead scope="col" className="w-[23%]">{t("Versions")}</TableHead>
              <TableHead scope="col" className="w-[22%]">{t("Scope")}</TableHead>
              <TableHead scope="col" className="pr-5">{t("Доставка")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!result && loading && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-36 text-center text-muted-foreground"
                >
                  {t("Загрузка обновлений…")}
                </TableCell>
              </TableRow>
            )}
            {result?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-40 text-center">
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
              <TableRow key={item.key} className="@max-3xl:grid @max-3xl:grid-cols-2 @max-3xl:gap-x-4 @max-3xl:gap-y-2.5 @max-3xl:px-4 @max-3xl:py-4 @max-3xl:[&>td]:p-0">
                <TableCell className="col-span-2 min-w-0 whitespace-normal py-4 pl-5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/updates/${item.encodedKey}`}
                      className="group inline-flex max-w-full items-start gap-1 rounded-sm font-semibold hover:underline focus-visible:outline-ring"
                    >
                      <span className="line-clamp-2 [overflow-wrap:anywhere]">
                        {item.comment ||
                          (item.appVersion
                            ? t("Version {0}", [item.appVersion])
                            : t("Release {0}", [item.updateId.slice(0, 8)]))}
                      </span>
                      <ArrowUpRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                    {item.isLatest && <LatestReleaseBadge />}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <code title={item.updateId}>{item.updateId.slice(0, 8)}</code>
                    <time dateTime={item.createdAt}>{fullDate(item.createdAt)}</time>
                  </div>
                </TableCell>
                <TableCell className="col-span-2 min-w-0">
                  <ReleaseVersionBadges {...item} />
                </TableCell>
                <TableCell className="min-w-0 space-y-1.5 whitespace-normal">
                  <div className="flex min-w-0 flex-wrap gap-1">
                    <PlatformBadge platform={item.platform} />
                    <ChannelBadge channel={item.channel} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="sr-only">{t("Audience")} · </span>
                    {item.audienceMode === "devices" ? t("Выбранные устройства") : t("All devices")}
                  </div>
                </TableCell>
                <TableCell className="min-w-0 space-y-1.5 whitespace-normal pr-5">
                  <div className="flex flex-wrap items-center gap-1">
                    <ReleaseStatusBadge release={item} />
                    {(item.isRollbackActive || item.isIgnoredByRollback) && (
                      <Badge
                        variant={item.isRollbackActive ? "destructive" : "warning"}
                        className="max-w-full whitespace-normal"
                      >
                        {item.isRollbackActive ? t("Rollback") : t("Ignored by rollback")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                    <span>{t(deliveryLabel(item.deliveryMode))}</span>
                    {item.hasGuard && <Badge variant="warning">{t("Guard")}</Badge>}
                  </div>
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
