"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { NativeSelect } from "@/components/ui/native-select";

import { getUpdates } from "@/src/client/admin-api";
import { UpdateItem } from "@/src/client/admin-types";
import DistributionControl from "@/src/client/distribution-control";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  ArrowDownUp,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Package,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const PAGE_SIZE = 20;

type SortBy =
  | "createdAt"
  | "runtimeVersion"
  | "platform"
  | "channel"
  | "stage"
  | "status"
  | "updateId";

export default function UpdatesPage() {
  const { t, formatLocale } = useI18n();
  const [items, setItems] = useState<UpdateItem[]>([]);
  const [rollbackScopes, setRollbackScopes] = useState<
    Array<{
      scopeKey: string;
      runtimeVersion: string;
      channel: string;
      platform: "ios" | "android";
      rollbackActive: boolean;
      autoDeliveryEnabled: boolean;
      activeUpdateId: string | null;
      latestUpdateId: string | null;
    }>
  >([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const hasRollbackActive = items.some((item) => item.isRollbackActive);
  const hasIgnoredUpdates = items.some((item) => item.isIgnoredByRollback);
  const lockedScopes = rollbackScopes.filter((scope) => scope.rollbackActive);

  const loadUpdates = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await getUpdates({
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        order,
      });
      setItems(response.items);
      setRollbackScopes(response.rollbackLockByScope || []);
      setTotalPages(response.totalPages);
      setTotal(response.total);
    } catch (loadError: unknown) {
      setError((loadError as Error).message || "Не удалось загрузить список");
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, order]);

  useEffect(() => {
    void loadUpdates();
  }, [loadUpdates]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">OTA Updates</h1>
          <p className="text-sm text-muted-foreground">
            {t("Публикации, версии и управление доставкой обновлений.")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void loadUpdates()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />{" "}
          {t(" Обновить")}
        </Button>
      </header>

      <DistributionControl />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t(error)}
        </div>
      )}
      {hasRollbackActive && (
        <div className="flex gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">{t("Rollback активен")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("Автодоставка новых обновлений временно отключена.")}
              {hasIgnoredUpdates
                ? t(" Новые публикации в этих scope помечены как ignored.")
                : ""}
            </p>
          </div>
        </div>
      )}
      {lockedScopes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Rollback lock:{" "}
          {lockedScopes
            .map(
              (scope) =>
                `${scope.runtimeVersion} / ${scope.platform} / ${scope.channel}`,
            )
            .join("; ")}
        </p>
      )}

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b p-4">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("Публикации")}</h2>
            <Badge variant="secondary">{total}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <NativeSelect
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as SortBy);
                setPage(1);
              }}
              aria-label={t("Сортировка списка апдейтов")}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="createdAt">{t("По дате")}</option>
              <option value="runtimeVersion">{t("По runtime")}</option>
              <option value="platform">{t("По платформе")}</option>
              <option value="channel">{t("По каналу")}</option>
              <option value="stage">{t("По stage")}</option>
              <option value="status">{t("По статусу")}</option>
              <option value="updateId">{t("По ID")}</option>
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOrder((current) => (current === "asc" ? "desc" : "asc"));
                setPage(1);
              }}
              aria-label={
                order === "asc"
                  ? t("Сортировать по убыванию")
                  : t("Сортировать по возрастанию")
              }
            >
              <ArrowDownUp />
              {order === "asc" ? "ASC" : "DESC"}
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-5">{t("Обновление")}</TableHead>
              <TableHead>Runtime / App</TableHead>
              <TableHead>{t("Платформа / канал")}</TableHead>
              <TableHead>{t("Состояние")}</TableHead>
              <TableHead>{t("Доставка")}</TableHead>
              <TableHead>Assets</TableHead>
              <TableHead className="pr-5 text-right">{t("Создано")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-36 text-center text-muted-foreground"
                >
                  <RefreshCw className="mx-auto mb-2 size-5 animate-spin" />
                  {t("Загрузка обновлений…")}
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-48 text-center">
                  <Package className="mx-auto mb-3 size-8 text-muted-foreground/50" />
                  <p className="font-medium">{t("Обновлений пока нет")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("Опубликуйте OTA, чтобы управлять его доставкой здесь.")}
                  </p>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              items.map((item) => (
                <TableRow
                  key={item.key}
                  className={item.isRollbackActive ? "bg-amber-500/5" : ""}
                >
                  <TableCell className="max-w-80 py-4 pl-5">
                    <Link
                      href={`/updates/${item.encodedKey}`}
                      className="group flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary"
                    >
                      <span className="truncate">
                        {item.comment || t("Без комментария")}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                    <Link
                      href={`/updates/${item.encodedKey}`}
                      className="mt-1 block max-w-60 truncate font-mono text-[11px] text-muted-foreground hover:text-primary"
                      title={item.updateId}
                    >
                      {item.updateId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{item.runtimeVersion}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      App {item.appVersion || "—"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {item.platform === "ios" ? "iOS" : "Android"}
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.channel}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant={
                          item.status === "active" ? "default" : "secondary"
                        }
                        className={
                          item.status === "active"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : ""
                        }
                      >
                        {item.status}
                      </Badge>
                      {item.isLatest && <Badge variant="outline">Latest</Badge>}
                      {item.audienceMode === "devices" && (
                        <Badge variant="outline">
                          {t("Выбранные устройства")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {item.stage}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        {item.deliveryMode === "background"
                          ? "Background"
                          : "Manual"}
                      </Badge>
                      {item.hasGuard && (
                        <Badge variant="secondary">Guard</Badge>
                      )}
                    </div>
                    <p
                      className={`mt-1.5 text-xs ${item.isRollbackActive ? "text-amber-600" : "text-muted-foreground"}`}
                    >
                      {item.isRollbackActive
                        ? "Rollback"
                        : item.isIgnoredByRollback
                          ? "Ignored by rollback"
                          : "Scope open"}
                    </p>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {item.assetsCount}
                  </TableCell>
                  <TableCell className="pr-5 text-right text-xs tabular-nums text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString(formatLocale) ||
                      item.createdAtPath}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {t("Страница ")}
            {page} {t(" из ")}
            {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft />
              {t("Назад")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              disabled={page >= totalPages || loading}
            >
              {t("Вперёд")}
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
