"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import type {
  ReleaseFilters,
  UpdatesListResponse,
} from "@/src/client/admin-types";
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

export default function UpdatesPage() {
  const { t } = useI18n();
  const { number, fullDate } = useFormatters();
  const [draft, setDraft] = useState(emptyFilters);
  const [query, setQuery] = useState({
    ...emptyFilters,
    page: 1,
    sortBy: "createdAt",
    order: "desc" as "asc" | "desc",
  });
  const [result, setResult] = useState<UpdatesListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resultsFiltered, setResultsFiltered] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getUpdates({ ...query, pageSize: 20 }, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setResult(next);
        setResultsFiltered(
          Boolean(
            query.q ||
              query.platform ||
              query.channel ||
              query.runtime ||
              query.status ||
              query.audience,
          ),
        );
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted)
          setError(e.message || "Не удалось загрузить список");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  function requestPage(next: typeof query) {
    setLoading(true);
    setError("");
    setQuery(next);
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    requestPage({ ...query, ...draft, q: draft.q.trim(), page: 1 });
  }
  function reset() {
    setDraft(emptyFilters);
    requestPage({ ...query, ...emptyFilters, page: 1 });
  }
  function filter(
    key: keyof ReleaseFilters,
    label: string,
    options: [string, string][],
  ) {
    return (
      <NativeSelect
        value={draft[key]}
        aria-label={label}
        className="max-w-48"
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      >
        <option value="">{label}</option>
        {options.map(([value, title]) => (
          <option key={value} value={value}>
            {title}
          </option>
        ))}
      </NativeSelect>
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
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => requestPage({ ...query })}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          {t("Обновить")}
        </Button>
      </header>

      <DistributionControl />

      {locked.length > 0 && (
        <div
          role="status"
          className="flex gap-3 rounded-lg border border-amber-500/35 bg-amber-500/5 p-4 text-sm"
        >
          <ShieldAlert className="size-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="font-medium">{t("Rollback активен")}</p>
            <p className="mt-1 break-words text-muted-foreground">
              {t("Автодоставка новых обновлений временно отключена.")}{" "}
              {locked
                .map((s) =>
                  [s.runtimeVersion, s.platform, s.channel].join(" / "),
                )
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      <Card className="min-w-0 gap-0 overflow-hidden py-0 shadow-none">
        <div className="space-y-4 border-b p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{t("Release history")}</h2>
              {result && (
                <Badge variant="secondary" className="tabular-nums">
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
          <form onSubmit={apply} role="search" className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label={t("Search releases")}
                placeholder={t(
                  "Search by comment, update ID, version or channel",
                )}
                className="pl-9"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </div>
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
              <Button type="submit" size="sm">
                {t("Применить")}
              </Button>
              {(Object.values(draft).some(Boolean) || resultsFiltered) && (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  {t("Сбросить")}
                </Button>
              )}
            </div>
          </form>
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
                  <div className="mt-1 break-words text-xs text-muted-foreground lg:hidden">
                    {item.platform === "ios" ? "iOS" : "Android"} ·{" "}
                    {item.channel} · {item.runtimeVersion}
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-60 whitespace-normal lg:table-cell">
                  <div className="break-words font-medium">
                    {item.platform === "ios" ? "iOS" : "Android"} ·{" "}
                    {item.channel}
                  </div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {t("Runtime {0}", [item.runtimeVersion])}
                    {item.appVersion ? ` · ${t("App")} ${item.appVersion}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1.5">
                    <Badge
                      variant={
                        item.status === "active" ? "default" : "secondary"
                      }
                    >
                      {item.policyEditable ? t("draft") : t(item.status)}
                    </Badge>
                    {item.isLatest && (
                      <span className="text-xs text-muted-foreground">
                        {t("Latest")}
                      </span>
                    )}
                    {(item.isRollbackActive || item.isIgnoredByRollback) && (
                      <span className="max-w-36 whitespace-normal text-xs text-amber-700 dark:text-amber-400">
                        {item.isRollbackActive
                          ? t("Rollback")
                          : t("Ignored by rollback")}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground sm:hidden">
                      {item.audienceMode === "devices"
                        ? t("Выбранные устройства")
                        : t("All devices")}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {item.audienceMode === "devices"
                    ? t("Выбранные устройства")
                    : t("All devices")}
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  {item.deliveryMode === "background"
                    ? t("Background")
                    : t("Manual")}
                  {item.hasGuard && (
                    <Badge className="ml-1.5" variant="outline">
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
    </div>
  );
}
