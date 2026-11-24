"use client";
import { useConfirmAction } from "@/components/admin/confirm-action";
import type { TranslationMessage } from "@/src/client/i18n/messages";
import { useI18n } from "@/src/client/i18n/provider";

import { AdminRoleContext } from "@/components/admin/admin-role";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

import {
  deleteEmbeddedUpdate,
  getEmbeddedUpdates,
} from "@/src/client/admin-api";
import { EmbeddedUpdateItem } from "@/src/client/admin-types";
import { useContext, useCallback, useEffect, useState } from "react";

export default function EmbeddedUpdatesPage() {
  const canWrite = useContext(AdminRoleContext) !== "viewer";
  const [query, setQuery] = useState("");
  const confirmAction = useConfirmAction();
  const { t, formatLocale } = useI18n();
  const [items, setItems] = useState<EmbeddedUpdateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<TranslationMessage>("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await getEmbeddedUpdates();
      setItems(response.items || []);
    } catch (loadError: unknown) {
      setError(
        (loadError as Error).message ||
          "Не удалось загрузить embedded обновления",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleDelete = async (embeddedUpdateId: string) => {
    const confirmed = await confirmAction(
      t("Удалить"),
      t("Удалить запись embedded update {0}?", [embeddedUpdateId]),
      true,
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(embeddedUpdateId);
    setError("");
    setSuccess("");

    try {
      await deleteEmbeddedUpdate(embeddedUpdateId);
      setSuccess({
        key: "Запись удалена: {0}",
        values: [embeddedUpdateId],
      });
      await loadItems();
    } catch (deleteError: unknown) {
      setError(
        (deleteError as Error).message ||
          "Не удалось удалить запись embedded update",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const search = query.trim().toLowerCase();
  const visible = items.filter((item) =>
    [item.embeddedUpdateId, item.appVersion, item.platform, item.channel].some(
      (field) => field?.toLowerCase().includes(search),
    ),
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Embedded builds")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("Встроенные версии приложения и регистрация нативных сборок.")}
            </p>
          </div>
          <Badge variant="secondary" className="px-3 py-1">
            {t("Builds: {0}", [items.length])}
          </Badge>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {t(error)}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {t(success)}
          </div>
        ) : null}

        <Card className="gap-0 overflow-hidden py-0 shadow-none">
          <div className="flex flex-wrap items-center gap-2 border-b p-4">
            <Input
              type="search"
              className="max-w-md"
              placeholder={t("Search embedded builds")}
              aria-label={t("Search embedded builds")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <Button variant="ghost" onClick={() => setQuery("")}>
                {t("Сбросить")}
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-full text-sm">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Created At")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("App version")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Platform")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Channel")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Embedded ID")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      className="h-36 px-3 py-4 text-center text-muted-foreground"
                      colSpan={6}
                    >
                      {t("Загрузка...")}
                    </TableCell>
                  </TableRow>
                ) : null}

                {!loading && visible.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="h-36 px-3 py-4 text-center text-muted-foreground"
                      colSpan={6}
                    >
                      {t("Embedded записи не найдены")}
                    </TableCell>
                  </TableRow>
                ) : null}

                {!loading
                  ? visible.map((item) => (
                      <TableRow
                        key={item.embeddedUpdateId}
                        className="border-t border-border "
                      >
                        <TableCell className="px-4 py-3">
                          {new Date(item.createdAt).toLocaleString(
                            formatLocale,
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {item.appVersion || "—"}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {item.platform}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge variant="outline">{item.channel}</Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-xs">
                          <span
                            className="block max-w-64 truncate select-all"
                            title={item.embeddedUpdateId}
                          >
                            {item.embeddedUpdateId}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {canWrite ? (
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={() =>
                                handleDelete(item.embeddedUpdateId)
                              }
                              disabled={deletingId === item.embeddedUpdateId}
                            >
                              {deletingId === item.embeddedUpdateId
                                ? t("Удаление...")
                                : t("Удалить")}
                            </Button>
                          ) : (
                            t("Read only")
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
