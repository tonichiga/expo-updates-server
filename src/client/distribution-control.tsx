"use client";

import {
  AdminApiError,
  getDistributionControl,
  setDistributionControl,
} from "./admin-api";
import type { DistributionControlResponse } from "./admin-types";
import { useCallback, useEffect, useState } from "react";

export function useDistributionControlState() {
  const [state, setState] = useState<DistributionControlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await getDistributionControl());
      setError("");
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить глобальный статус OTA",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  return { state, setState, loading, error, setError, refresh };
}

function formatChangedBy(state: DistributionControlResponse): string {
  const role = state.changedBy.role ? ` (${state.changedBy.role})` : "";
  return `${state.changedBy.label}${role}`;
}

export function DistributionControlBanner({
  state,
  loading,
  error,
}: {
  state: DistributionControlResponse | null;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <section className="rounded-xl border border-zinc-300 bg-zinc-100 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        Проверка глобального статуса OTA…
      </section>
    );
  }

  if (error || !state) {
    return (
      <section className="rounded-xl border border-red-400 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
        ⚠️ Глобальный статус OTA недоступен. Распространяющие действия
        отключены до восстановления связи.
        {error ? <p className="mt-1 text-xs">{error}</p> : null}
      </section>
    );
  }

  if (!state.blocked) {
    return null;
  }

  return (
    <section className="rounded-xl border-2 border-red-500 bg-red-50 p-4 text-red-950 dark:bg-red-950/50 dark:text-red-100">
      <p className="font-semibold">⛔ OTA DISTRIBUTION BLOCKED</p>
      <p className="mt-1 text-sm">{state.reason}</p>
      <p className="mt-2 text-xs">
        {new Date(state.changedAt).toLocaleString("uk-UA")} ·{" "}
        {formatChangedBy(state)}
      </p>
    </section>
  );
}

export default function DistributionControl() {
  const { state, setState, loading, error, setError, refresh } =
    useDistributionControlState();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const changeState = async (blocked: boolean) => {
    if (!state) {
      return;
    }

    const normalizedReason = reason.trim();
    if (blocked && !normalizedReason) {
      setError("Укажите причину аварийной блокировки.");
      return;
    }

    const confirmed = window.confirm(
      blocked
        ? "Немедленно остановить выдачу manifest и всех OTA assets для всех клиентов?"
        : "Возобновить глобальное OTA-распространение?",
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await setDistributionControl({
        blocked,
        ...(blocked ? { reason: normalizedReason } : {}),
        expectedVersion: state.version,
      });
      setState({ ...updated, canWrite: state.canWrite });
      setReason("");
      setMessage(
        blocked
          ? "OTA-распространение остановлено."
          : "OTA-распространение возобновлено.",
      );
    } catch (saveError: unknown) {
      if (saveError instanceof AdminApiError && saveError.status === 409) {
        await refresh();
        setError(
          "Состояние уже изменил другой оператор. Данные обновлены; проверьте их и повторите действие.",
        );
      } else {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Не удалось изменить глобальный статус OTA",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={`rounded-xl border-2 p-4 ${
        state?.blocked
          ? "border-red-500 bg-red-50 dark:bg-red-950/50"
          : "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider">
            Global OTA emergency switch
          </p>
          <h2 className="mt-1 text-xl font-bold">
            {loading ? "LOADING…" : state?.blocked ? "BLOCKED" : "ACTIVE"}
          </h2>
          {state ? (
            <div className="mt-2 space-y-1 text-sm">
              <p>
                {state.blocked
                  ? state.reason
                  : "Manifest и assets выдаются в обычном режиме."}
              </p>
              <p className="text-xs opacity-75">
                Изменено: {new Date(state.changedAt).toLocaleString("uk-UA")} ·{" "}
                {formatChangedBy(state)} · version {state.version}
              </p>
            </div>
          ) : null}
        </div>

        {state?.canWrite ? (
          <div className="w-full max-w-xl">
            {!state.blocked ? (
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                aria-label="Причина аварийной блокировки OTA"
                placeholder="Обязательная причина остановки (до 500 символов)"
                className="min-h-20 w-full rounded-md border border-red-300 bg-white p-2 text-sm text-zinc-950 dark:border-red-800 dark:bg-zinc-950 dark:text-zinc-100"
              />
            ) : null}
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void changeState(!state.blocked)}
              className={`mt-2 rounded-md px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                state.blocked
                  ? "bg-emerald-700 hover:bg-emerald-800"
                  : "bg-red-700 hover:bg-red-800"
              }`}
            >
              {saving
                ? "Сохранение…"
                : state.blocked
                  ? "Возобновить OTA"
                  : "Остановить все OTA"}
            </button>
          </div>
        ) : state ? (
          <p className="rounded-md border border-zinc-300 px-3 py-2 text-xs dark:border-zinc-700">
            Read-only: требуется updates:write
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-red-100 p-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-md bg-emerald-100 p-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
    </section>
  );
}
