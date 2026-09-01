"use client";

import {
  deleteEmbeddedUpdate,
  getEmbeddedUpdates,
} from "@/src/client/admin-api";
import { EmbeddedUpdateItem } from "@/src/client/admin-types";
import LogoutButton from "@/src/client/logout-button";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function EmbeddedUpdatesPage() {
  const [items, setItems] = useState<EmbeddedUpdateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
    const confirmed = window.confirm(
      `Удалить запись embedded update ${embeddedUpdateId}?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(embeddedUpdateId);
    setError("");
    setSuccess("");

    try {
      await deleteEmbeddedUpdate(embeddedUpdateId);
      setSuccess(`Запись удалена: ${embeddedUpdateId}`);
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

  return (
    <main className="min-h-screen bg-zinc-50 p-4 dark:bg-zinc-950 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Embedded Updates</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Записей: {items.length}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/updates"
              className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              OTA Updates
            </Link>
            <LogoutButton />
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {success}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-100 dark:bg-zinc-800">
                <tr>
                  <th className="px-4 py-4 text-left">Created At</th>
                  <th className="px-4 py-4 text-left">App version</th>
                  <th className="px-4 py-4 text-left">Platform</th>
                  <th className="px-4 py-4 text-left">Channel</th>
                  <th className="px-4 py-4 text-left">Embedded ID</th>
                  <th className="px-4 py-4 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-3 py-4 text-zinc-500" colSpan={6}>
                      Загрузка...
                    </td>
                  </tr>
                ) : null}

                {!loading && items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-zinc-500" colSpan={6}>
                      Embedded записи не найдены
                    </td>
                  </tr>
                ) : null}

                {!loading
                  ? items.map((item) => (
                      <tr
                        key={item.embeddedUpdateId}
                        className="border-t border-zinc-200 dark:border-zinc-800"
                      >
                        <td className="px-4 py-4">
                          {new Date(item.createdAt).toLocaleString("uk-UA")}
                        </td>
                        <td className="px-4 py-4">
                          {item.appVersion || "—"}
                        </td>
                        <td className="px-4 py-4">{item.platform}</td>
                        <td className="px-4 py-4">{item.channel}</td>
                        <td className="px-4 py-4 font-mono text-xs">
                          {item.embeddedUpdateId}
                        </td>
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            onClick={() => handleDelete(item.embeddedUpdateId)}
                            disabled={deletingId === item.embeddedUpdateId}
                            className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/40"
                          >
                            {deletingId === item.embeddedUpdateId
                              ? "Удаление..."
                              : "Удалить"}
                          </button>
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
