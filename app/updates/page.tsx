"use client";

import { getUpdates } from "@/src/client/admin-api";
import { UpdateItem } from "@/src/client/admin-types";
import LogoutButton from "@/src/client/logout-button";
import Link from "next/link";
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
    <main className="min-h-screen bg-zinc-50 p-4 dark:bg-zinc-950 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">OTA Updates</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Всего апдейтов: {total}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/updates/emergency-redirects"
              className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Emergency
            </Link>
            <Link
              href="/updates/embedded"
              className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Embedded
            </Link>
            <label className="text-sm">Сортировка</label>
            <select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as SortBy);
                setPage(1);
              }}
              aria-label="Сортировка списка апдейтов"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-2 text-sm dark:border-zinc-700"
            >
              <option value="createdAt">Дата</option>
              <option value="runtimeVersion">Runtime</option>
              <option value="platform">Платформа</option>
              <option value="channel">Канал</option>
              <option value="stage">Stage</option>
              <option value="status">Статус</option>
              <option value="updateId">ID</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setOrder((current) => (current === "asc" ? "desc" : "asc"));
                setPage(1);
              }}
              className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {order === "asc" ? "ASC" : "DESC"}
            </button>
            <LogoutButton />
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {hasRollbackActive ? (
          <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-200">
            ⚠️ Rollback активен: автодоставка новых апдейтов временно отключена.
            {hasIgnoredUpdates
              ? " Новые апдейты в этом scope помечены как ignored."
              : ""}
          </div>
        ) : null}

        {lockedScopes.length > 0 ? (
          <div className="rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200">
            <p className="font-medium">Rollback lock по scope:</p>
            <p className="mt-1 text-xs">
              {lockedScopes
                .map(
                  (scope) =>
                    `${scope.runtimeVersion} / ${scope.platform} / ${scope.channel}`,
                )
                .join("; ")}
            </p>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-100 dark:bg-zinc-800">
                <tr>
                  <th className="px-4 py-4 text-left">Дата</th>
                  <th className="px-4 py-4 text-left">Runtime</th>
                  <th className="px-4 py-4 text-left">App version</th>
                  <th className="px-4 py-4 text-left">Платформа</th>
                  <th className="px-4 py-4 text-left">Канал</th>
                  <th className="px-4 py-4 text-left">Комментарий</th>
                  <th className="px-4 py-4 text-left">Stage</th>
                  <th className="px-4 py-4 text-left">Статус</th>
                  <th className="px-4 py-4 text-left">Режим</th>
                  <th className="px-4 py-4 text-left">Latest</th>
                  <th className="px-4 py-4 text-left">Assets</th>
                  <th className="px-4 py-4 text-left">ID</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-3 py-4 text-zinc-500" colSpan={12}>
                      Загрузка...
                    </td>
                  </tr>
                ) : null}

                {!loading && items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-zinc-500" colSpan={12}>
                      Апдейты не найдены
                    </td>
                  </tr>
                ) : null}

                {!loading
                  ? items.map((item) => (
                      <tr
                        key={item.key}
                        className={`border-t border-zinc-200 dark:border-zinc-800 ${
                          item.isRollbackActive
                            ? "bg-amber-50/70 dark:bg-amber-950/30"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-4">
                          {new Date(item.createdAt).toLocaleString("uk-UA") ||
                            item.createdAtPath}
                        </td>
                        <td className="px-4 py-4">{item.runtimeVersion}</td>
                        <td className="px-4 py-4">
                          {item.appVersion || "—"}
                        </td>
                        <td className="px-4 py-4">{item.platform}</td>
                        <td className="px-4 py-4">{item.channel}</td>
                        <td className="px-4 py-4">
                          <div
                            className="max-w-72 truncate"
                            title={item.comment || ""}
                          >
                            {item.comment || "-"}
                          </div>
                        </td>
                        <td className="px-4 py-4">{item.stage}</td>
                        <td className="px-4 py-4">{item.status}</td>
                        <td className="px-4 py-4">
                          {item.isRollbackActive ? (
                            <span className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-700 dark:text-amber-300">
                              rollback
                            </span>
                          ) : item.isIgnoredByRollback ? (
                            <span className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-600 dark:text-zinc-300">
                              ignored
                            </span>
                          ) : (
                            <span className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-700 dark:text-emerald-300">
                              auto
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {item.isLatest ? "Да" : "Нет"}
                        </td>
                        <td className="px-4 py-4">{item.assetsCount}</td>
                        <td className="px-4 py-4">
                          <Link
                            href={`/updates/${item.encodedKey}`}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {item.updateId}
                          </Link>
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Страница {page} из {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
                className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page >= totalPages || loading}
                className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Вперёд
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
