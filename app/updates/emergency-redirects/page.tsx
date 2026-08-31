"use client";

import {
  createEmergencyRedirect,
  deleteEmergencyRedirect,
  getAdminSession,
  getEmergencyRedirects,
  updateEmergencyRedirect,
} from "@/src/client/admin-api";
import {
  EmergencyRedirectInput,
  EmergencyRedirectItem,
} from "@/src/client/admin-types";
import LogoutButton from "@/src/client/logout-button";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

const EMPTY_FORM: EmergencyRedirectInput = {
  name: "",
  enabled: true,
  embeddedUpdateId: "",
  runtimeVersion: "",
  platform: "android",
  fromChannel: "development",
  toChannel: "production",
  targetMode: "pinned",
  expectedUpdateId: null,
};

export default function EmergencyRedirectsPage() {
  const [items, setItems] = useState<EmergencyRedirectItem[]>([]);
  const [form, setForm] = useState<EmergencyRedirectInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [redirects, session] = await Promise.all([
        getEmergencyRedirects(),
        getAdminSession(),
      ]);
      setItems(redirects.items || []);
      setCanWrite(session.role === "admin" || session.role === "operator");
    } catch (loadError: unknown) {
      setError(
        (loadError as Error).message ||
          "Не удалось загрузить emergency redirects",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        expectedUpdateId: form.expectedUpdateId?.trim() || null,
      };

      if (editingId) {
        await updateEmergencyRedirect(editingId, payload);
        setSuccess("Emergency redirect обновлён");
      } else {
        await createEmergencyRedirect(payload);
        setSuccess("Emergency redirect создан");
      }

      resetForm();
      await load();
    } catch (saveError: unknown) {
      setError(
        (saveError as Error).message ||
          "Не удалось сохранить emergency redirect",
      );
    } finally {
      setSaving(false);
    }
  };

  const edit = (item: EmergencyRedirectItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      enabled: item.enabled,
      embeddedUpdateId: item.embeddedUpdateId,
      runtimeVersion: item.runtimeVersion,
      platform: item.platform,
      fromChannel: item.fromChannel,
      toChannel: item.toChannel,
      targetMode: item.targetMode,
      expectedUpdateId: item.expectedUpdateId,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggle = async (item: EmergencyRedirectItem) => {
    setError("");
    setSuccess("");
    try {
      await updateEmergencyRedirect(item.id, { enabled: !item.enabled });
      setSuccess(item.enabled ? "Redirect отключён" : "Redirect включён");
      await load();
    } catch (toggleError: unknown) {
      setError((toggleError as Error).message || "Не удалось изменить статус");
    }
  };

  const remove = async (item: EmergencyRedirectItem) => {
    if (!window.confirm(`Удалить emergency redirect "${item.name}"?`)) {
      return;
    }

    setError("");
    setSuccess("");
    try {
      await deleteEmergencyRedirect(item.id);
      setSuccess("Emergency redirect удалён");
      if (editingId === item.id) {
        resetForm();
      }
      await load();
    } catch (deleteError: unknown) {
      setError((deleteError as Error).message || "Не удалось удалить redirect");
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4 dark:bg-zinc-950 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Emergency Redirects</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Точечное перенаправление ошибочных embedded builds
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/updates"
              className="rounded-md border border-zinc-300 px-4 py-3 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
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

        {canWrite ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {editingId ? "Редактирование правила" : "Новое правило"}
              </h2>
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
                >
                  Отменить
                </button>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Input
                label="Название"
                value={form.name}
                onChange={(value) => setForm({ ...form, name: value })}
              />
              <Input
                label="Runtime version"
                value={form.runtimeVersion}
                onChange={(value) =>
                  setForm({ ...form, runtimeVersion: value })
                }
              />
              <label className="space-y-1 text-sm">
                <span>Platform</span>
                <select
                  value={form.platform}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      platform: event.target.value as "ios" | "android",
                    })
                  }
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                >
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                </select>
              </label>
              <Input
                label="Embedded update ID"
                value={form.embeddedUpdateId}
                onChange={(value) =>
                  setForm({ ...form, embeddedUpdateId: value })
                }
              />
              <Input
                label="From channel"
                value={form.fromChannel}
                onChange={(value) => setForm({ ...form, fromChannel: value })}
              />
              <Input
                label="To channel"
                value={form.toChannel}
                onChange={(value) => setForm({ ...form, toChannel: value })}
              />
              <label className="space-y-1 text-sm">
                <span>Target mode</span>
                <select
                  value={form.targetMode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      targetMode: event.target.value as "pinned" | "follow",
                    })
                  }
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                >
                  <option value="pinned">Pinned update</option>
                  <option value="follow">Follow channel</option>
                </select>
              </label>
              <Input
                label={
                  form.targetMode === "pinned"
                    ? "Expected update ID"
                    : "Expected update ID (optional)"
                }
                value={form.expectedUpdateId || ""}
                required={form.targetMode === "pinned"}
                onChange={(value) =>
                  setForm({ ...form, expectedUpdateId: value || null })
                }
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />
              Включить правило сразу после сохранения
            </label>

            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving
                ? "Сохранение..."
                : editingId
                  ? "Сохранить изменения"
                  : "Создать redirect"}
            </button>
          </form>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-100 dark:bg-zinc-800">
                <tr>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Scope</th>
                  <th className="px-4 py-3 text-left">Redirect</th>
                  <th className="px-4 py-3 text-left">Target</th>
                  <th className="px-4 py-3 text-left">Embedded ID</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-4 text-zinc-500">
                      Загрузка...
                    </td>
                  </tr>
                ) : null}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-4 text-zinc-500">
                      Emergency redirects не настроены
                    </td>
                  </tr>
                ) : null}
                {!loading
                  ? items.map((item) => (
                      <tr
                        key={item.id}
                        className="border-t border-zinc-200 dark:border-zinc-800"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={
                              item.enabled
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-zinc-500"
                            }
                          >
                            {item.enabled ? "enabled" : "disabled"}
                          </span>
                        </td>
                        <td className="px-4 py-3">{item.name}</td>
                        <td className="px-4 py-3">
                          {item.runtimeVersion} / {item.platform}
                        </td>
                        <td className="px-4 py-3">
                          {item.fromChannel} → {item.toChannel}
                        </td>
                        <td className="px-4 py-3">
                          <div>{item.targetMode}</div>
                          {item.expectedUpdateId ? (
                            <div className="font-mono text-xs text-zinc-500">
                              {item.expectedUpdateId}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {item.embeddedUpdateId}
                        </td>
                        <td className="px-4 py-3">
                          {canWrite ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => edit(item)}
                                className="text-blue-600 hover:underline dark:text-blue-400"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggle(item)}
                                className="text-amber-700 hover:underline dark:text-amber-400"
                              >
                                {item.enabled ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void remove(item)}
                                className="text-red-600 hover:underline dark:text-red-400"
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-500">
                              Read only
                            </span>
                          )}
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

function Input({
  label,
  value,
  onChange,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span>{label}</span>
      <input
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
      />
    </label>
  );
}
